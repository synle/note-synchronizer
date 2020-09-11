// @ts-nocheck
require("dotenv").config();

import fs from "fs";
import moment from "moment";
import startCase from "lodash/startCase";
import trim from "lodash/trim";
import getImageSize from "image-size";

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
  interestedEmails,
  ignoredWordTokens,
} from "./appConstantsEnums";
import * as commonUtils from "./commonUtils";
import * as DataUtils from "./dataUtils";

let noteDestinationFolderId;

const MIN_SUBJECT_LENGTH = 10;
const IMAGE_MAX_WIDTH = 710;

function _sanitizeSubject(
  subject,
  to,
  friendlyDateTimeString2,
  isChat,
  isEmail
) {
  subject = (subject || "").trim();
  if (subject.length <= MIN_SUBJECT_LENGTH) {
    // if subject is too short, let's add the from
    subject = `${subject} ${to}`;
  }
  subject = `${friendlyDateTimeString2} ${subject}`;

  if (isChat) {
    if (!subject.toLowerCase().includes("chat")) {
      subject = `${subject} Chat`;
    }
  }

  return trim(_sanitizeFileName(subject), " -_><:.()[]{}");
}

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
      .replace("\r", "\n")
      .replace("\t", " ")
      .split("\n")
      .map((r) => (r || "").trim())
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
      children.push(
        new Paragraph({
          text: `================================`,
          spacing: {
            before: 250,
            after: 250,
          },
          heading: HeadingLevel.HEADING_3,
        })
      );

      children.push(
        new Paragraph({
          text: `Total Images: ${images.length}`,
          spacing: {
            before: 250,
            after: 250,
          },
          heading: HeadingLevel.HEADING_3,
        })
      );

      for (const attachment of images) {
        const attachmentImageSize = getImageSize(attachment.path);
        let ratio = attachmentImageSize.height / attachmentImageSize.width;
        if (ratio <= 0) {
          ratio = 1;
        }

        const attachmentImage = Media.addImage(
          doc,
          fs.readFileSync(attachment.path),
          IMAGE_MAX_WIDTH, // width
          IMAGE_MAX_WIDTH * ratio // height
        );
        children.push(
          new Paragraph({
            text: `${attachment.fileName}`,
            bold: true,
            heading: HeadingLevel.HEADING_3,
            spacing: {
              before: 400,
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

  logger.debug(`generateDocFile Success file=${newFileName}`);

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
    return !attachment.mimeType.includes("image") && attachment.size > 0;
  });
}

async function _init() {
  if (!noteDestinationFolderId) {
    noteDestinationFolderId = await googleApiUtils.getNoteDestinationFolderId();
  }
}

export async function uploadEmailMsgToGoogleDrive(messageId) {
  await _init();
  const email = await DataUtils.getEmailByMessageId(messageId);
  if (email) {
    const threadId = email.threadId;

    const emails = await DataUtils.getEmailsByThreadId(threadId);

    // make sure that we only process if this is the last email message
    if (email.id === emails[emails.length - 1].id) {
      logger.debug(
        `Start uploadEmailMsgToGoogleDrive threadId=${threadId} id=${messageId}`
      );
      return uploadEmailThreadToGoogleDrive(threadId);
    } else {
      logger.debug(
        `Skipped uploadEmailMsgToGoogleDrive due to it not being the last messageId threadId=${threadId} id=${messageId}`
      );
    }
  } else {
    logger.error(
      `Error with uploadEmailMsgToGoogleDrive Cannot find message with messageId=${messageId}`
    );
  }
}

async function _processThreads(threadId, emails: Email[]) {
  let folderName;
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
  let hasIgnoredWordTokens = false;
  let docSubject;

  const googleFileAppProperties = {
    threadId,
  };

  // all attachments
  const attachments = await DataUtils.getAttachmentsByThreadId(threadId);
  const allNonImageAttachments: Attachment[] = _getNonImagesAttachments(
    attachments
  );
  const allImageAttachments: Attachment[] = _getImageAttachments(attachments);
  const hasSomeAttachments =
    allNonImageAttachments.length > 0 ||
    allImageAttachments.filter((attachment) => attachment.size >= 25000)
      .length > 0;

  // involvedEmails
  let emailAddresses = [];
  let from;

  for (let email of emails) {
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

    isEmailSentByMe = isEmailSentByMe || email.isEmailSentByMe;

    isEmailSentByMeToMe =
      isEmailSentByMeToMe ||
      (isEmailSentByMe &&
        interestedEmails.some((myEmail) =>
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

    if (!docSubject) {
      docSubject = email.subject;
    }

    if (!dateStart) {
      dateStart = friendlyDateTimeString1;
    }
    dateEnd = friendlyDateTimeString1;

    const isChat = email.isChat;
    const isEmail = email.isEmail;

    let subject = email.subject;
    let to = email.to;
    subject = _sanitizeSubject(
      subject,
      to,
      friendlyDateTimeString2,
      isChat,
      isEmail
    );

    if (!from) {
      from = email.from;
    }

    starred = starred || email.starred;

    date = email.date;

    if (
      ignoredWordTokens.some((ignoredToken) =>
        email.rawBody.toLowerCase().includes(ignoredToken.toLowerCase())
      ) ||
      ignoredWordTokens.some((ignoredToken) =>
        `${email.subject}|||${email.from}`
          .toLowerCase()
          .includes(ignoredToken.toLowerCase())
      )
    ) {
      hasIgnoredWordTokens = hasIgnoredWordTokens || true;
    }

    if (!folderName) {
      // create the parent folder
      folderName = isChat
        ? "_chats"
        : commonUtils.generateFolderName(email.from);
    }

    // concatenate body
    if (isChat) {
      if (!docFileName && !email.isEmailSentByMe) {
        docFileName = subject;
      }

      docContentSections.push({
        body: `
        ================================
        ${
          email.isEmailSentByMe ? "ME" : email.from
        } ${friendlyDateTimeString1} (${email.id}):
        ${email.body || email.rawBody}
      `,
        images,
      });
    } else {
      if (!docFileName) {
        docFileName = subject;
      }

      const gmailLink = email.from.includes("getpocket")
        ? ""
        : `Link:
            http://mail.google.com/mail/u/0/#search/messageid/${email.id}`;

      docContentSections.push({
        body: `
        ================================
        Date: ${friendlyDateTimeString1}
        From: ${email.from}
        To: ${toEmailAddresses}
        MessageId: ${email.id}
        ${gmailLink}
        ================================
        ${email.body || email.rawBody}
      `,
        images,
      });
    }
  }

  logger.debug(
    `Checking to see if we should sync to google drive threadId=${threadId} isEmailSentByMe=${isEmailSentByMe} isEmailSentByMeToMe=${isEmailSentByMeToMe} hasSomeAttachments=${hasSomeAttachments} nonImagesAttachments=${allNonImageAttachments.length} allImageAttachments=${allImageAttachments.length} starred=${starred} hasIgnoredWordTokens=${hasIgnoredWordTokens}`
  );

  let shouldUpload = false;
  if (hasIgnoredWordTokens && !isEmailSentByMeToMe && !starred) {
    shouldUpload = false;
  } else if (
    isEmailSentByMe ||
    isEmailSentByMeToMe ||
    hasSomeAttachments ||
    starred
  ) {
    shouldUpload = true;
  }

  logger.debug(
    `Should upload this thread threadId=${threadId} shouldUpload=${shouldUpload}`
  );

  if (shouldUpload) {
    logger.debug(`Doing Sync to Google Drive threadId=${threadId}`);

    // create the parent folder
    folderId = await googleApiUtils.createDriveFolder({
      name: folderName,
      description: `Chats & Emails from ${folderName}`,
      parentFolderId: noteDestinationFolderId,
      starred: isEmailSentByMe,
      folderColorRgb: isEmailSentByMe ? "#FF0000" : "#0000FF",
      appProperties: {
        fromDomain: folderName,
      },
    });

    // update the folder id into the database
    await DataUtils.bulkUpsertFolders({
      folderName: folderName,
      driveFileId: folderId,
    });

    emailAddresses = [...new Set(emailAddresses)];

    // upload attachments
    let attachmentIdx = 1;
    let attachmentLinks = [];
    for (let attachment of allNonImageAttachments) {
      const attachmentName = _sanitizeFileName(
        `${docFileName} File#${attachmentIdx} ${attachment.fileName}`
      );
      attachmentIdx++;

      logger.debug(
        `Upload Attachment threadId=${threadId} attachmentName=${attachmentName} ${attachment.mimeType}`
      );

      try {
        const attachmentSha = commonUtils.get256Hash(attachment.path);
        const attachmentDriveFileId = await googleApiUtils.uploadFile({
          name: attachmentName,
          mimeType: attachment.mimeType,
          dateEpochTime: parseInt(date) * 1000,
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

        // retain the attachment links to be put inside the doc later
        attachmentLinks.push(
          `
        ${attachment.fileName}
        http://drive.google.com/file/d/${attachmentDriveFileId}
        `.trim()
        );

        logger.debug(
          `Link to Attachment threadId=${threadId} attachmentName=${attachmentName} attachmentLink=drive.google.com/file/d/${attachmentDriveFileId}`
        );

        await DataUtils.bulkUpsertAttachments({
          path: attachment.path,
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

    // then upload original docs
    const docLocalPath = `${PROCESSED_EMAIL_PREFIX_PATH}/processed.threadId.${threadId}.docx`;

    // append attachment link
    if (attachmentLinks.length > 0) {
      docContentSections = [
        {
          body: `
          ================================
          Total Attachments: ${attachmentLinks.length}

          ${attachmentLinks.join("\n\n")}
        `,
        },
      ].concat(docContentSections);
    }

    // this is the initial section of the email
    docContentSections = [
      {
        body: `
          ================================
          ThreadId: ${threadId}
          Start: ${dateStart}
          End: ${dateEnd}
          Uploaded: ${moment().format(FORMAT_DATE_TIME1)}
          Total Messages: ${emails.length}
        `,
      },
    ].concat(docContentSections);

    await generateDocFile(docSubject, docContentSections, docLocalPath);
    const docSha = commonUtils.get256Hash(`${threadId}.mainEmail`);
    docDriveFileId = await googleApiUtils.uploadFile({
      name: docFileName,
      mimeType: MIME_TYPE_ENUM.APP_MS_DOCX,
      dateEpochTime: parseInt(date) * 1000,
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

    logger.debug(
      `Link to google doc threadId=${threadId} docLink=docs.google.com/document/d/${docDriveFileId}  parentFolderLink=drive.google.com/drive/folders/${folderId} folderName=${folderName} attachmentLinks=${attachmentLinks.length}`
    );

    await DataUtils.bulkUpsertEmails(
      emails.map((email) => {
        return {
          ...email,
          status: THREAD_JOB_STATUS_ENUM.SUCCESS,
          driveFileId: docDriveFileId,
        };
      })
    );
  } else {
    logger.debug(`Skipped Sync to Google Drive threadId=${threadId}`);

    await DataUtils.bulkUpsertEmails(
      emails.map((email) => {
        return {
          ...email,
          status: THREAD_JOB_STATUS_ENUM.SKIPPED,
          driveFileId: docDriveFileId,
        };
      })
    );
  }

  return docDriveFileId;
}

export async function uploadEmailThreadToGoogleDrive(threadId) {
  await _init();
  const emails = await DataUtils.getEmailsByThreadId(threadId);
  if (emails.length > 0) {
    return _processThreads(threadId, emails);
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
