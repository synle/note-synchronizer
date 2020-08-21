// @ts-nocheck
require("dotenv").config();
import fs from "fs";
import { Email, Attachment } from "../types";
import * as googleApiUtils from "./googleApiUtils";
import { logger } from "../loggers";
import {
  myEmails,
  ignoredWordTokens,
  THREAD_JOB_STATUS_ENUM,
  MIME_TYPE_ENUM,
} from "./commonUtils";
import * as DataUtils from "./dataUtils";
import moment from "moment";

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
    .split(" ")
    .filter((r) => r && r.length > 0)
    .join(" ")
    .trim();
}

async function _init() {
  noteDestinationFolderId = await googleApiUtils.getNoteDestinationFolderId();

  logger.debug(
    `ID for Google Drive Note Sync Folder: ${noteDestinationFolderId}`
  );
}

async function _processThreadEmail(email: Email) {
  let { threadId, id, from, bcc, to, subject, date, labelIds } = email;

  try {
    await DataUtils.updateEmailUploadStatus({
      id,
      upload_status: THREAD_JOB_STATUS_ENUM.IN_PROGRESS,
    });

    const Attachments = await DataUtils.getAttachmentByThreadIds(threadId);

    const toEmailList = (bcc || "")
      .split(",")
      .concat((to || "").split(","))
      .map((r) => r.trim())
      .filter((r) => !!r);

    const attachments: Attachment[] = Attachments.filter((attachment) => {
      // only use attachments that is not small images
      const attachmentStats = fs.statSync(attachment.path);
      const fileSize = attachmentStats.size;

      if (attachment.mimeType.includes("image")) {
        return attachmentStats.size >= MINIMUM_IMAGE_SIZE_IN_BITS;
      }
      switch (attachment.mimeType) {
        case MIME_TYPE_ENUM.TEXT_CSV:
        case MIME_TYPE_ENUM.APP_MS_XLS:
        case MIME_TYPE_ENUM.APP_MS_XLSX:
        case MIME_TYPE_ENUM.APP_XML:
        case MIME_TYPE_ENUM.APP_JSON:
        case MIME_TYPE_ENUM.APP_RTF:
        case MIME_TYPE_ENUM.APP_MS_DOC:
        case MIME_TYPE_ENUM.APP_MS_DOCX:
        case MIME_TYPE_ENUM.TEXT_X_AMP_HTML:
        case MIME_TYPE_ENUM.TEXT_HTML:
        case MIME_TYPE_ENUM.TEXT_PLAIN:
        case MIME_TYPE_ENUM.TEXT_XML:
        case MIME_TYPE_ENUM.TEXT_JAVA:
        case MIME_TYPE_ENUM.TEXT_JAVA_SOURCE:
        case MIME_TYPE_ENUM.TEXT_CSHARP:
        case MIME_TYPE_ENUM.APP_MS_PPT:
        case MIME_TYPE_ENUM.APP_MS_PPTX:
          return true;
        default:
          return fileSize >= 2000; // needs to be at least 2KB to upload
      }
    });

    const labelIdsList = (labelIds || "").split(",");

    const starred = labelIdsList.some((labelId) => labelId.includes("STARRED"));

    const rawBody = (email.rawBody || "").trim();

    const toEmailAddresses = toEmailList.join(", ");

    const isEmailSentByMe = myEmails.some((myEmail) => from.includes(myEmail));

    const isEmailSentToMySelf =
      isEmailSentByMe &&
      myEmails.some((myEmail) =>
        toEmailList.some((toEmail) => toEmail.includes(myEmail))
      );

    const hasSomeAttachments = attachments.length > 0;

    const friendlyDateTimeString = moment(parseInt(date)).format(
      "MM/DD/YY hh:mmA"
    );
    subject = `${subject} ${friendlyDateTimeString}`;

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
      let folderToUse = noteDestinationFolderId;

      if (labelIdsList.some((labelId) => labelId.includes("CHAT"))) {
        // create the sub folder
        const folderName = `${from} Chats`.trim();
        folderToUse = await googleApiUtils.createDriveFolder(
          folderName,
          folderName,
          noteDestinationFolderId,
          "0000FF" // blue for chat
        );
      } else {
        // create the sub folder
        const folderName = `${from} Emails`.trim();
        folderToUse = await googleApiUtils.createDriveFolder(
          folderName,
          folderName,
          noteDestinationFolderId,
          "FF0000" // red for email
        );
      }

      // upload the doc itself
      // only log email if there're some content
      const localPath = `${PROCESSED_EMAIL_PREFIX_PATH}/processed.${email.id}.data`;
      if (rawBody.length > 0) {
        docFileName = _sanitizeFileName(subject);

        try {
          const fileContent = `
          <h1>${subject}</h1>
          <hr />
          <div><b><u>Date:</u></b> ${friendlyDateTimeString}</div>
          <div><b><u>From:</u></b> ${from}</div>
          <div><b><u>To:</u></b> ${toEmailAddresses}</div>
          <div><b><u>ThreadId:</u></b> ${threadId}</div>
          <div><b><u>MessageId:</u></b> ${id}</div>
          <style>
            *{
              padding: 0 !important;
              margin: 0 0 10px 0 !important;
              background: none !important;
              border: none !important;
              color: black !important;
            }
            a{
              color: blue !important
            }
          </style>
          <hr />
          ${rawBody}`.trim();
          fs.writeFileSync(localPath, fileContent.trim());

          logger.debug(`Upload original note file ${docFileName}`);

          await googleApiUtils.uploadFile(
            docFileName,
            "text/html",
            localPath,
            `
            Main Email

            Date:
            ${friendlyDateTimeString}

            From:
            ${from}

            Subject:
            ${subject}

            threadId:
            ${threadId}

            id:
            ${id}
            `.trim(),
            date,
            starred,
            folderToUse
          );
        } catch (err) {
          logger.error(
            `Error - Failed ot original note - threadId=${threadId} id=${id} subject=${subject} attachmentName=${docFileName} localPath=${localPath} ${
              err.stack || JSON.stringify(err, null, 2)
            }`
          );
        }
      }

      // then upload the associated attachments
      logger.debug(
        `Start upload attachment job threadId=${threadId} id=${id} subject=${subject} ${attachments.length}`
      );
      let AttachmentIdx = 0;
      for (let attachment of attachments) {
        AttachmentIdx++;
        const attachmentName = _sanitizeFileName(
          `${docFileName} #${AttachmentIdx} ${attachment.fileName}`
        );

        logger.debug(
          `Upload Attachment threadId=${threadId} id=${id} subject=${subject} attachmentName=${attachmentName} ${attachment.mimeType}`
        );

        try {
          await googleApiUtils.uploadFile(
            attachmentName,
            attachment.mimeType,
            attachment.path,
            `
            Attachment #${AttachmentIdx}

            Date
            ${friendlyDateTimeString}

            From
            ${from}

            Subject
            ${subject}

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
            folderToUse
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

  let countProcessedMessages = 0;

  for (let email of emails) {
    const percentDone = (
      (countProcessedMessages / countTotalMessages) *
      100
    ).toFixed(2);
    if (
      percentDone === 0 ||
      percentDone % 20 === 0 ||
      countProcessedMessages % 100 === 0
    ) {
      logger.debug(
        `Progress for Uploading Notes: ${percentDone}% (${countProcessedMessages}/${countTotalMessages})`
      );
    }
    countProcessedMessages++;

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
