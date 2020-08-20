// @ts-nocheck
require("dotenv").config();
import fs from "fs";
import { Email, Attachment } from "../types";
import { getNoteDestinationFolderId, uploadFile } from "./googleApiUtils";
import { logger } from "../loggers";
import { myEmails, ignoredWordTokens, THREAD_JOB_STATUS } from "./commonUtils";
import * as DataUtils from "./dataUtils";

let noteDestinationFolderId;

const PROCESSED_EMAIL_PREFIX_PATH = "./processed";

const MINIMUM_IMAGE_SIZE_IN_BITS = 12000;

function _sanitizeFileName(string) {
  return string
    .replace("|", " ")
    .replace("[", " ")
    .replace("]", " ")
    .replace(".", " ")
    .replace("-", " ")
    .replace("_", " ")
    .replace("_", " ")
    .replace(/re:/gi, "")
    .replace(/fw/gi, "")
    .replace(":", "")
    .split(" ")
    .filter((r) => r && r.length > 0)
    .join(" ")
    .trim();
}

async function _init() {
  noteDestinationFolderId = await getNoteDestinationFolderId();

  logger.debug(
    `ID for Google Drive Note Sync Folder: ${noteDestinationFolderId}`
  );
}

async function _processThreadEmail(email: Email) {
  try {
    let { threadId, id, from, bcc, to, subject, date, labelIds } = email;

    await DataUtils.updateEmailUploadStatus({
      id: id,
      upload_status: THREAD_JOB_STATUS.IN_PROGRESS,
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

      if (attachment.mimeType.includes("image")) {
        return attachmentStats.size >= MINIMUM_IMAGE_SIZE_IN_BITS;
      }
      return true;
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

    const friendlyDateString = new Date(parseInt(date)).toLocaleDateString();

    subject = `${friendlyDateString} ${subject}`;

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
        id: id,
        upload_status: THREAD_JOB_STATUS.SUCCESS,
      });

      return; // skip this
    }

    if (isEmailSentByMe || isEmailSentToMySelf || hasSomeAttachments) {
      let folderToUse = noteDestinationFolderId;

      if (labelIdsList.some((labelId) => labelId.includes("CHAT"))) {
        // create the sub folder
        const folderName = `Chats With ${from}`.trim();
        noteDestinationFolderId = await createDriveFolder(
          folderName,
          folderName,
          noteDestinationFolderId,
          "0000FF" // blue for chat
        );
      } else {
        // create the sub folder
        const folderName = `Emails With ${from}`.trim();
        noteDestinationFolderId = await createDriveFolder(
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
          <div><b><u>Date:</u></b> ${new Date(date).toLocaleString()}</div>
          <div><b><u>From:</u></b> ${from}</div>
          <div><b><u>To:</u></b> ${toEmailAddresses}</div>
          <div><b><u>ThreadId:</u></b> ${threadId}</div>
          <div><b><u>MessageId:</u></b> ${id}</div>
          <style>
            *{
              padding: 0 !important;
              margin: 0 0 10px 0 !important;
            }
          </style>
          <hr />
          ${rawBody}`.trim();
          fs.writeFileSync(localPath, fileContent.trim());

          logger.debug(`Upload original note file ${docFileName}`);

          await uploadFile(
            docFileName,
            "text/html",
            localPath,
            `
            Main Email
            Date:
            ${new Date().toLocaleDateString()}

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
          `${docFileName} - ${new Date().toLocaleDateString()} - #${AttachmentIdx} - ${
            attachment.fileName
          }`
        );

        logger.debug(
          `Upload Attachment threadId=${threadId} id=${id} subject=${subject} attachmentName=${attachmentName} ${attachment.mimeType}`
        );

        try {
          await uploadFile(
            attachmentName,
            attachment.mimeType,
            attachment.path,
            `
            Attachment #${AttachmentIdx}

            Date
            ${new Date().toLocaleDateString()}

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
      upload_status: THREAD_JOB_STATUS.SUCCESS,
    });
  } catch (err) {
    logger.error(
      `Failed to process emails with threadId=${email.threadId} messageId=${email.id}`
    );

    await DataUtils.updateEmailUploadStatus({
      id: id,
      upload_status: THREAD_JOB_STATUS.ERROR_GENERIC,
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

  uploadFile(
    "...Note_Sync_Log.info",
    "text/plain",
    "./logs/log_warn.data",
    `Note Synchronizer Log`,
    Date.now(),
    false, // not starred
    noteDestinationFolderId
  );

  uploadFile(
    "...Note_Sync_Log.verbose",
    "text/plain",
    "./logs/log_combined.data",
    `Note Synchronizer Log`,
    Date.now(),
    false, // not starred
    noteDestinationFolderId
  );
}
