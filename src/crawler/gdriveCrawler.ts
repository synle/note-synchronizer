// @ts-nocheck
require("dotenv").config();

import fs from "fs";
import moment from "moment";

import { Document, Media, Packer, Paragraph, HeadingLevel } from "docx";

import { Email, Attachment } from "../types";
import * as googleApiUtils from "./googleApiUtils";
import { logger } from "../loggers";
import {
  THREAD_JOB_STATUS_ENUM,
  MIME_TYPE_ENUM,
  PROCESSED_EMAIL_PREFIX_PATH,
  FORMAT_DATE_TIME1,
  FORMAT_DATE_TIME2,
  ignoredWordTokens,
} from "./appConstantsEnums";
import * as commonUtils from "./commonUtils";
import * as mySignatureTokens from "./appConstantsEnums";
import * as DataUtils from "./dataUtils";

let noteDestinationFolderId;

function _sanitizeFileName(string) {
  return string
    .replace("|", " ")
    .replace("[", " ")
    .replace("]", " ")
    .replace("_", " ")
    .replace("-", " ")
    .replace(".", " ")
    .replace(/re:/gi, "")
    .replace(/fwd:?/gi, "")
    .replace(/fw:?/gi, "")
    .split(" ")
    .filter((r) => r && r.length > 0)
    .join(" ")
    .trim();
}

export async function generateDocFile(subject, sections, newFileName) {
  logger.debug(`generateDocFile subject=${subject} file=${newFileName}`);
  const doc = new Document();
  const children = [];

  children.push(
    new Paragraph({
      text: subject,
      heading: HeadingLevel.HEADING_1,
      color: "#ff0000",
    })
  );

  sections = [].concat(sections);
  for (let section of sections) {
    let body = section.body;
    let images = section.images || [];

    body = body
      .split("\n")
      .map((r) => r.trim())
      .filter((r) => !!r);
    for (let content of body) {
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
    }

    if (images.length > 0) {
      for (const attachment of images) {
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
    }
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
  if (!noteDestinationFolderId) {
    noteDestinationFolderId = await googleApiUtils.getNoteDestinationFolderId();
  }
}

async function _processThreads(threadId, emails: Email[]) {
  let folderId;
  let docDriveFileId;
  let docFileName;
  let docContentSections = [];
  let starred = false;
  let dateStart;
  let dateEnd;
  let date;
  let isEmailSentByMe;
  let isEmailSentByMeToMe;
  let shouldUploadThisEmail;

  await DataUtils.bulkUpsertThreadJobStatuses({
    threadId: threadId,
    status: THREAD_JOB_STATUS_ENUM.IN_PROGRESS,
  });

  const googleFileAppProperties = {
    threadId,
  };

  // all attachments
  const attachments = await DataUtils.getAttachmentsByThreadId(threadId);
  const allNonImageAttachments: Attachment[] = _getNonImagesAttachments(
    attachments
  );
  const hasSomeAttachments = allNonImageAttachments.length > 0;

  // involvedEmails
  let emailAddresses = [];
  let from;

  for (let email of emails) {
    email.body = email.body || "";

    emailAddresses = emailAddresses
      .concat((email.from || "").split(","))
      .concat((email.bcc || "").split(","))
      .concat((email.to || "").split(","))
      .map((r) => r.trim())
      .filter((r) => !!r);

    const toEmailList = []
      .concat((email.bcc || "").split(","))
      .concat((email.to || "").split(","))
      .map((r) => r.trim())
      .filter((r) => !!r);
    const toEmailAddresses = toEmailList.join(", ");

    isEmailSentByMe =
      isEmailSentByMe ||
      mySignatureTokens.interestedEmails.some((myEmail) =>
        email.from.includes(myEmail)
      );

    isEmailSentByMeToMe =
      isEmailSentByMeToMe ||
      (isEmailSentByMe &&
        mySignatureTokens.interestedEmails.some((myEmail) =>
          toEmailList.some((toEmail) => toEmail.includes(myEmail))
        ));

    const attachments = await DataUtils.getAttachmentsByMessageId(email.id);
    const images: Attachment[] = _getImageAttachments(attachments);

    const friendlyDateTimeString1 = moment(parseInt(email.date) * 1000).format(
      FORMAT_DATE_TIME1
    );

    const friendlyDateTimeString2 = moment(parseInt(email.date) * 1000).format(
      FORMAT_DATE_TIME2
    );

    if (!dateStart) {
      dateStart = friendlyDateTimeString1;
    }
    dateEnd = friendlyDateTimeString1;

    const labelIdsList = (email.labelIds || "").split(",");

    let isChat = false;
    let isEmail = true;
    let subject = email.subject;
    if (labelIdsList.some((labelId) => labelId.includes("CHAT"))) {
      isChat = true;
      isEmail = false;
      subject = `${friendlyDateTimeString2} Chat : ${subject}`;
    } else {
      subject = `${friendlyDateTimeString2} ${subject}`;
    }
    if (!docFileName) {
      docFileName = subject;
    }

    if (!from) {
      from = email.from;
    }

    if (isEmailSentByMe) {
      starred = true;
    }

    date = email.date;

    const hasIgnoredWordToken = ignoredWordTokens.some((ignoredWord) =>
      email.body.toLowerCase().includes(ignoredWord.toLowerCase())
    );

    if (shouldUploadThisEmail === undefined) {
      shouldUploadThisEmail =
        !hasIgnoredWordToken &&
        (isEmailSentByMe || isEmailSentByMeToMe || hasSomeAttachments);
    }


    if (shouldUploadThisEmail && !folderId) {
      // create the parent folder
      const folderName = commonUtils.generateFolderName(email.from);
      folderId = await googleApiUtils.createDriveFolder({
        name: folderName,
        description: `Chats & Emails from ${folderName}`,
        parentFolderId: noteDestinationFolderId,
        starred,
        folderColorRgb: starred ? "#FF0000" : "#0000FF",
        appProperties: {
          fromDomain: folderName,
        },
      });

      // update the folder id into the database
      await DataUtils.bulkUpsertFolders({
        folderName: folderName,
        driveFileId: folderId,
      });

      // create the folder that are grouped by year
      // this is where we will store the data
      // const yearString = moment(parseInt(email.date) * 1000).format("YYYY");
      // folderId = await googleApiUtils.createDriveFolder({
      //   name: `${folderName} ${yearString}`,
      //   description: `Chats & Emails from ${folderName} in year ${yearString}`,
      //   parentFolderId: folderId,
      //   starred,
      //   folderColorRgb: "#00FFFF",
      //   appProperties: {
      //     fromDomainAndYear: `${folderName}-${yearString}`,
      //   },
      // });
    }

    // concatenate body
    if (isChat) {
      if (docContentSections.length === 0) {
        // this is the initial section of the email
        docContentSections.push({
          body: `
        ====================================
        ThreadId: ${threadId}
        Uploaded: ${moment().format(FORMAT_DATE_TIME1)}
      `,
        });
      }

      docContentSections.push({
        body: `
        ====================================
        ${friendlyDateTimeString1} ${from}:
        ${email.body}
      `,
        images,
      });
    } else {
      if (docContentSections.length === 0) {
        // this is the initial section of the email
        docContentSections.push({
          body: `
        ====================================
        ThreadId: ${threadId}
        Uploaded: ${moment().format(FORMAT_DATE_TIME1)}
      `,
        });
      }

      docContentSections.push({
        body: `
        ====================================
        Date: ${friendlyDateTimeString1}
        From: ${from}
        To: ${toEmailAddresses}
        MessageId: ${email.id}
        ====================================
        ${email.body}
      `,
        images,
      });
    }
  }

  if (shouldUploadThisEmail) {
    logger.debug(`Passed validation, uploading content threadId=${threadId}`);
    emailAddresses = [...new Set(emailAddresses)];

    const docLocalPath = `${PROCESSED_EMAIL_PREFIX_PATH}/processed.threadId.${threadId}.docx`;

    await generateDocFile(docFileName, docContentSections, docLocalPath);

    const docSha = commonUtils.get256Hash(`${threadId}.mainEmail`);

    docDriveFileId = await googleApiUtils.uploadFile({
      name: docFileName,
      mimeType: MIME_TYPE_ENUM.APP_MS_DOCX,
      localPath: docLocalPath,
      description: `
    Main Email
    From:
    ${from}

    Date: ${dateStart} - ${dateEnd}

    Path:
    ${docLocalPath}

    SHA:
    ${docSha}

    ThreadId:
    ${threadId}
    `
        .split("\n")
        .map((r) => r.trim())
        .join("\n"),
      date,
      starred,
      parentFolderId: folderId,
      appProperties: {
        sha: docSha,
        ...googleFileAppProperties,
      },
    });

    // upload attachments
    let attachmentIdx = 1;
    for (let attachment of allNonImageAttachments) {
      attachmentIdx++;
      const attachmentName = _sanitizeFileName(
        `${docFileName} #${attachmentIdx} ${attachment.fileName}`
      );

      logger.debug(
        `Upload Attachment threadId=${threadId} attachmentName=${attachmentName} ${attachment.mimeType}`
      );

      try {
        // upload attachment
        const attachmentSha = commonUtils.get256Hash(attachment.id);

        const attachmentDriveFileId = await googleApiUtils.uploadFile({
          name: attachmentName,
          mimeType: attachment.mimeType,
          localPath: attachment.path,
          description: `
        Attachment #${attachmentIdx}
        From:
        ${from}

        Date: ${dateStart} - ${dateEnd}

        ThreadId:
        ${threadId}

        Path:
        ${attachment.path}

        SHA:
        ${attachmentSha}

        AttachmentId:
        ${attachment.id.substr(0, 25)}
        `
            .split("\n")
            .map((r) => r.trim())
            .join("\n"),
          date,
          starred,
          parentFolderId: folderId,
          appProperties: {
            sha: attachmentSha,
            ...googleFileAppProperties,
          },
        });

        await DataUtils.bulkUpsertAttachments({
          id: attachment.id,
          driveFileId: attachmentDriveFileId,
        });
      } catch (err) {
        logger.error(
          `Error - Failed upload attachment - threadId=${threadId} attachmentName=${attachmentName} ${
            attachment.mimeType
          } path=${attachment.path} error=${JSON.stringify(err.stack || err)}`
        );
      }
    }

    await DataUtils.bulkUpsertThreadJobStatuses({
      threadId: threadId,
      status: THREAD_JOB_STATUS_ENUM.SUCCESS,
    });
  } else {
    logger.debug(
      `Failed validation, Skipped uploading content threadId=${threadId}`
    );

    await DataUtils.bulkUpsertThreadJobStatuses({
      threadId: threadId,
      status: THREAD_JOB_STATUS_ENUM.SKIPPED,
    });
  }

  return docDriveFileId;
}

export async function uploadEmailThreadToGoogleDrive(threadId) {
  await _init();
  const emails = await DataUtils.getEmailsByThreadId(threadId);
  if (emails.length > 0) {
    try {
      return _processThreads(threadId, emails);
    } catch (err) {
      logger.error(
        `Failed to upload thread with threadId=${threadId} err=${err.stack}`
      );
    }
  } else {
    logger.error(`Cannot find message with threadId=${threadId}`);
  }
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
