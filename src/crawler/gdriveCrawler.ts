// @ts-nocheck
require("dotenv").config();

import fs from "fs";
import { Readability } from "@mozilla/readability";
import moment from "moment";

import {
  Document,
  HorizontalPositionAlign,
  HorizontalPositionRelativeFrom,
  Media,
  Packer,
  Paragraph,
  VerticalPositionAlign,
  VerticalPositionRelativeFrom,
  TextRun,
  HeadingLevel,
  PageBreak,
} from "docx";

import { Email, Attachment } from "../types";
import * as googleApiUtils from "./googleApiUtils";
import { logger } from "../loggers";
import {
  myEmails,
  ignoredWordTokens,
  THREAD_JOB_STATUS_ENUM,
  MIME_TYPE_ENUM,
} from "./commonUtils";
import { tryParseBody } from "./gmailCrawler";
import * as DataUtils from "./dataUtils";

let noteDestinationFolderId;

const PROCESSED_EMAIL_PREFIX_PATH = "./processed";

const MINIMUM_IMAGE_SIZE_IN_BITS = 16000;

function _sanitizeFileName(string) {
  return string
    .replace("|", " ")
    .replace("[", " ")
    .replace("]", " ")
    .replace("_", " ")
    .replace("-", " ")
    .replace(".", " ")
    .replace(/re:/gi, "")
    .replace(/fw:?/gi, "")
    .replace(/fwd:?/gi, "")
    .split(" ")
    .filter((r) => r && r.length > 0)
    .join(" ")
    .trim();
}

// this get the domain out of the email
function _generateFolderName(string) {
  string = string.toLowerCase();

  if (myEmails.some((myEmail) => string.includes(myEmail))) {
    // if sent by me, then group things under the same label
    return "_ME";
  }

  if (
    string.includes("gmail") ||
    string.includes("yahoo.com") ||
    string.includes("ymail") ||
    string.includes("hotmail.com") ||
    string.includes("aol.com")
  ) {
    // common email domain, then should use their full name
    return string.trim();
  }

  // break up things after @ and before the last dot
  let domainParts = string.split(/[@.]/g);

  const resParts = [
    domainParts[domainParts.length - 2],
    domainParts[domainParts.length - 1],
  ];

  return resParts.join(".").trim();
}

export async function generateDocFile(
  subject,
  body,
  rawContent,
  attachments,
  newFileName
) {
  logger.debug(`generateDocFile subject=${subject} file=${newFileName}`);
  const doc = new Document();
  const children = [];

  children.push(
    new Paragraph({
      text: subject,
      heading: HeadingLevel.TITLE,
      color: "#ff0000",
    })
  );

  body = [].concat(body || []);
  for (let content of body) {
    content = (content || "").trim();

    if (content.length === 0) {
      continue;
    }

    children.push(
      new Paragraph({
        text: content,
        border: {
          top: {
            color: "auto",
            space: 1,
            value: "single",
            size: 10,
          },
          bottom: {
            color: "auto",
            space: 1,
            value: "single",
            size: 10,
          },
        },
        spacing: {
          before: 250,
          after: 250,
        },
        heading: HeadingLevel.HEADING_3,
        color: "#0000FF",
      })
    );
  }

  rawContent = tryParseBody(rawContent)
    .split(/[ ]/g)
    .map((s) => (s || "").trim())
    .filter((s) => !!s)
    .join(" ")
    .trim()
    .replace(/[\r\n]/g, "\n")
    .split('\n')
  for (let content of rawContent) {
    content = (content || "").trim();

    if (content.length === 0) {
      continue;
    }

    children.push(
      new Paragraph({
        text: content,
        spacing: {
          before: 250,
          after: 250,
        },
        heading: HeadingLevel.HEADING_3,
      })
    );


    children.push(
      new Paragraph({// empty space
        text: "",
        spacing: {
          before: 250,
          after: 250,
        },
        heading: HeadingLevel.HEADING_3,
      })
    );
  }

  children.push(
    new Paragraph({
      text: 'Attachments',
      spacing: {
        before: 250,
        after: 250,
      },
      border: {
        top: {
          color: "auto",
          space: 1,
          value: "single",
          size: 10,
        },
      },
      heading: HeadingLevel.HEADING_2,
    })
  );

  for (const attachment of attachments) {
    const attachmentImage = Media.addImage(
      doc,
      fs.readFileSync(attachment.path),
      700,
      800
    );
    children.push(
      new Paragraph({
        text: `${attachment.fileName}`,
        bold: true,
        heading: HeadingLevel.HEADING_4,
        spacing: {
          before: 250,
        },
        border: {
          bottom: {
            color: "auto",
            space: 1,
            value: "single",
            size: 6,
          },
        },
      })
    );
    children.push(new Paragraph(attachmentImage));
  }

  doc.addSection({
    children,
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(newFileName, buffer);

  logger.debug(
    `generateDocFile - Success subject=${subject} file=${newFileName}`
  );

  return newFileName;
}

export function _getImageAttachments(attachments: Attachment[]): Attachment[] {
  return attachments.filter((attachment) => {
    return attachment.mimeType.includes("image");
  });
}

export function _getNonImagesAttachments(
  attachments: Attachment[]
): Attachment[] {
  return attachments.filter((attachment) => {
    return !attachment.mimeType.includes("image");
  });
}

async function _init() {
  noteDestinationFolderId = await googleApiUtils.getNoteDestinationFolderId();

  logger.debug(
    `ID for Google Drive Note Sync Folder: ${noteDestinationFolderId}`
  );
}

async function _processThreadEmail(email: Email) {
  let { threadId, id, from, bcc, to, subject, rawSubject, date, labelIds } = email;

  try {
    await DataUtils.updateEmailUploadStatus({
      id,
      upload_status: THREAD_JOB_STATUS_ENUM.IN_PROGRESS,
    });

    const Attachments = await DataUtils.getAttachmentByMessageId(id);

    const toEmailList = (bcc || "")
      .split(",")
      .concat((to || "").split(","))
      .map((r) => r.trim())
      .filter((r) => !!r);

    const nonImageAttachments: Attachment[] = _getNonImagesAttachments(
      Attachments
    );
    const imagesAttachments: Attachment[] = _getImageAttachments(Attachments);

    const labelIdsList = (labelIds || "").split(",");

    const rawBody = (email.rawBody || "").trim();

    const body = email.body || rawBody;

    const toEmailAddresses = toEmailList.join(", ");

    const isEmailSentByMe = myEmails.some((myEmail) => from.includes(myEmail));

    const isEmailSentToMySelf = myEmails.some((myEmail) =>
      toEmailList.some((toEmail) => toEmail.includes(myEmail))
    );

    const starred = labelIdsList.some((labelId) => labelId.includes("STARRED")) || (isEmailSentByMe && isEmailSentToMySelf);

    const hasSomeAttachments =
      nonImageAttachments.length > 0 || imagesAttachments.length > 0;

    const friendlyDateTimeString1 = moment(parseInt(date)).format(
      "MM/DD/YY hh:mmA"
    );

    const friendlyDateTimeString2 = moment(parseInt(date)).format(
      "YY/MM/DD HH:mm"
    );

    if (labelIdsList.some((labelId) => labelId.includes("CHAT"))) {
      subject = `Chat ${friendlyDateTimeString2} ${subject}`;
    } else {
      subject = `Email ${friendlyDateTimeString2} ${subject}`;
    }

    let docFileName = `${subject}`;

    // ignored if content contains the ignored patterns
    if (
      ignoredWordTokens.some((ignoredToken) =>
        rawBody.toLowerCase().includes(ignoredToken)
      ) ||
      ignoredWordTokens.some((ignoredToken) =>
        subject.toLowerCase().includes(ignoredToken)
      )
    ) {
      logger.debug(
        `Skipped due to Ignored Pattern: threadId=${threadId} id=${id} subject=${subject}`
      );

      await DataUtils.updateEmailUploadStatus({
        id,
        upload_status: THREAD_JOB_STATUS_ENUM.SKIPPED,
      });

      return; // skip this
    }

    if (isEmailSentByMe || isEmailSentToMySelf || hasSomeAttachments) {
      // create the bucket folder
      const fromEmailDomain = _generateFolderName(from);
      const folderIdToUse = await googleApiUtils.createDriveFolder(
        fromEmailDomain,
        `Chats & Emails from this domain ${fromEmailDomain}`,
        isEmailSentByMe, // star emails sent from myself
        noteDestinationFolderId,
        isEmailSentByMe ? "#FF0000" : "#0000FF",
        {
          fromDomain: fromEmailDomain,
        }
      );

      // upload the doc itself
      // only log email if there're some content
      const localPath = `${PROCESSED_EMAIL_PREFIX_PATH}/processed.${email.id}.docx`;

      logger.debug(
        `Start upload original note threadId=${threadId} id=${id} subject=${subject} imageFiles=${imagesAttachments.length} nonImageAttachments=${nonImageAttachments.length}`
      );

      if (rawBody.length > 0) {
        docFileName = _sanitizeFileName(subject);

        try {
          await generateDocFile(
            subject,
            `
            Date:
            ${friendlyDateTimeString1}

            From:
            ${from}

            To:
            ${toEmailAddresses}

            ThreadId:
            ${threadId}

            MessageId:
            ${id}
            `
              .trim()
              .split("\n"),
            body,
            imagesAttachments,
            localPath
          );

          logger.debug(`Upload original note file ${docFileName}`);

          // upload original doc
          await googleApiUtils.uploadFile(
            docFileName,
            MIME_TYPE_ENUM.APP_MS_DOCX,
            localPath,
            `
            Main Email

            Date:
            ${friendlyDateTimeString1}

            From:
            ${from}

            Subject:
            ${rawSubject}

            threadId:
            ${threadId}

            id:
            ${id}
            `.trim(),
            date,
            starred,
            folderIdToUse,
            {
              // app property
              from,
              id,
              threadId,
            }
          );
        } catch (err) {
          logger.error(
            `Error - Failed to upload original note - threadId=${threadId} id=${id} subject=${subject} attachmentName=${docFileName} localPath=${localPath} ${
              err.stack || JSON.stringify(err, null, 2)
            }`
          );
        }
      }

      // then upload the associated attachments
      logger.debug(
        `Start upload attachment job threadId=${threadId} id=${id} subject=${subject} ${nonImageAttachments.length}`
      );
      let AttachmentIdx = 0;
      for (let attachment of nonImageAttachments) {
        AttachmentIdx++;
        const attachmentName = _sanitizeFileName(
          `${docFileName} #${AttachmentIdx} ${attachment.fileName}`
        );

        logger.debug(
          `Upload Attachment threadId=${threadId} id=${id} subject=${subject} attachmentName=${attachmentName} ${attachment.mimeType}`
        );

        try {
          // upload attachment
          await googleApiUtils.uploadFile(
            attachmentName,
            attachment.mimeType,
            attachment.path,
            `
            Attachment #${AttachmentIdx}

            Date
            ${friendlyDateTimeString1}

            From
            ${from}

            Subject
            ${rawSubject}

            threadId
            ${threadId}

            id
            ${id}

            Path
            ${attachment.path}

            attachmentId
            ${attachment.id}
            `.trim(),
            date,
            starred,
            folderIdToUse,
            {
              // app property
              from,
              id,
              threadId,
            }
          );
        } catch (err) {
          logger.error(
            `Error - Failed upload attachment - threadId=${threadId} id=${id} subject=${subject} attachmentName=${attachmentName} ${
              attachment.mimeType
            } path=${attachment.path} ${
              err.stack || JSON.stringify(err, null, 2)
            }`
          );
        }
      }
    } else {
      logger.debug(`Skipped threadId=${threadId} id=${id} subject=${subject}`);
    }

    await DataUtils.updateEmailUploadStatus({
      id: id,
      upload_status: THREAD_JOB_STATUS_ENUM.SUCCESS,
    });
  } catch (err) {
    logger.error(
      `Failed to process emails with threadId=${email.threadId} messageId=${email.id} err=${err.stack}`
    );

    await DataUtils.updateEmailUploadStatus({
      id: id,
      upload_status: THREAD_JOB_STATUS_ENUM.ERROR_GENERIC,
    });
  }
}

async function _processThreadEmails(emails: Email[]) {
  const countTotalMessages = emails.length;
  logger.debug(
    `Total Messages To Sync with Google Drive: ${countTotalMessages} firstId=${emails[0].id}`
  );
  for (let email of emails) {
    await _processThreadEmail(email);
  }
}

/**
 * entry point to start work on a single item
 * @param targetThreadId
 */
export async function uploadEmailThreadToGoogleDrive(targetThreadId) {
  await _init();
  const matchedResults = await DataUtils.getEmailsByThreadId(targetThreadId);
  await _processThreadEmails(matchedResults);
}

export async function uploadLogsToDrive() {
  await _init();

  logger.debug("uploadLogsToDrive");

  googleApiUtils.uploadFile(
    "...Note_Sync_Log.info",
    "text/plain",
    "./logs/log_warn.data",
    `Note Synchronizer Log`,
    Date.now(),
    false, // not starred
    noteDestinationFolderId
  );

  googleApiUtils.uploadFile(
    "...Note_Sync_Log.verbose",
    "text/plain",
    "./logs/log_combined.data",
    `Note Synchronizer Log`,
    Date.now(),
    false, // not starred
    noteDestinationFolderId
  );
}
