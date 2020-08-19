// @ts-nocheck
require("dotenv").config();
import fs from "fs";
const { chunk } = require("lodash");

import { Email, DatabaseResponse, Attachment } from "../types";
import Models from "../models/modelsSchema";
import { getNoteDestinationFolderId, uploadFile } from "./googleApiUtils";
import { logger } from "../loggers";
import { myEmails, ignoredWordTokens } from "./commonUtils";

let noteDestinationFolderId;

const PROCESSED_EMAIL_PREFIX_PATH = "./processed";

const MINIMUM_IMAGE_SIZE_IN_BITS = 30000;

function _sanitizeFileName(string) {
  return string
    .replace("|", " ")
    .replace("[", " ")
    .replace("]", " ")
    .replace(".", " ")
    .replace("-", " ")
    .replace("_", " ")
    .replace("_", " ")
    .split(" ")
    .filter((r) => r && r.length > 0)
    .join(" ");
}

async function _init() {
  noteDestinationFolderId = getNoteDestinationFolderId();

  logger.debug(
    `ID for Google Drive Note Sync Folder: ${noteDestinationFolderId}`
  );
}

async function _processMessages(emails: Email[]) {
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
        `${percentDone}% (${countProcessedMessages}/${countTotalMessages})`
      );
    }
    countProcessedMessages++;

    let { threadId, id, from, bcc, to, subject, date, labelIds } = email;
    const toEmailList = (bcc || "")
      .split(",")
      .concat((to || "").split(","))
      .map((r) => r.trim())
      .filter((r) => !!r);
    const attachments: Attachment[] = email.Attachments.filter((attachment) => {
      // only use attachments that is not small images
      const attachmentStats = fs.statSync(attachment.path);
      return (
        (attachmentStats.size < MINIMUM_IMAGE_SIZE_IN_BITS &&
          attachment.mimeType.includes("images/")) ||
        !attachment.mimeType.includes("images/")
      );
    });

    subject = (subject || "").trim();

    const labelIdsList = (labelIds || "").split(",");

    const starred = labelIdsList.some((labelId) => labelId.includes("STARRED"));

    const rawBody = (email.rawBody || "").trim();

    const toEmailAddresses = toEmailList.join(", ");

    let docFileName = subject;

    const isEmailSentByMe = myEmails.some((myEmail) => from.includes(myEmail));

    const isEmailSentToMySelf =
      isEmailSentByMe &&
      myEmails.some((myEmail) =>
        toEmailList.some((toEmail) => toEmail.includes(myEmail))
      );

    const hasSomeAttachments = attachments.length > 0;

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

      continue; // skipped
    }

    if (isEmailSentByMe || isEmailSentToMySelf || hasSomeAttachments) {
      // upload the doc itself
      // only log email if there're some content
      if (rawBody.length > 0) {
        const localPath = `${PROCESSED_EMAIL_PREFIX_PATH}/processed.${email.id}.data`;

        docFileName = _sanitizeFileName(subject);

        try {
          const fileContent = `
          <h1>${subject}</h1>
          <hr />
          <div><b><u>from:</u></b> ${from}</div>
          <div><b><u>to:</u></b> ${toEmailAddresses}</div>
          <div><b><u>threadId:</u></b> ${threadId}</div>
          <div><b><u>messageId:</u></b> ${id}</div>
          <hr />
          ${rawBody}`.trim();
          fs.writeFileSync(localPath, fileContent.trim());

          logger.debug(`Upload original note file ${docFileName}`);

          await uploadFile(
            docFileName || `${from} Email Message ${id}`,
            "text/html",
            localPath,
            `subject=${subject} (threadId=${threadId}) (id=${id}) Main Email`,
            date,
            starred,
            noteDestinationFolderId
          );
        } catch (e) {
          logger.error(
            `Error - Failed ot original note - threadId=${threadId} id=${id} subject=${subject} attachmentName=${docFileName} ${
              attachment.mimeType
            } ${JSON.stringify(e, null, 2)}`
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
          `${docFileName} - #${AttachmentIdx} - ${attachment.fileName}`
        );

        logger.debug(
          `Upload Attachment threadId=${threadId} id=${id} subject=${subject} attachmentName=${attachmentName} ${attachment.mimeType}`
        );

        try {
          await uploadFile(
            attachmentName,
            attachment.mimeType,
            attachment.path,
            `subject=${subject} (threadId=${threadId}) (id=${id}) Attachment #${AttachmentIdx}`,
            date,
            starred,
            noteDestinationFolderId
          );
        } catch (e) {
          logger.error(
            `Error - Failed ot upload attachment - threadId=${threadId} id=${id} subject=${subject} attachmentName=${attachmentName} ${
              attachment.mimeType
            } ${JSON.stringify(e, null, 2)}`
          );
        }
      }
    } else {
      logger.debug(`Skipped threadId=${threadId} id=${id} subject=${subject}`);
    }
  }
}

export async function doGdriveWorkForAllItems() {
  await _init();

  logger.info(`doGdriveWorkForAllItems`);

  const matchedResults: DatabaseResponse<Email>[] = await Models.Email.findAll({
    where: {},
    include: [
      {
        model: Models.Attachment,
        required: false,
      },
    ],
  });

  const threadChunks = chunk(
    _transformMatchedThreadsResults(matchedResults),
    15
  ); // maximum parallel

  for (let threads of threadChunks) {
    await _processMessages(threads);
  }
}

/**
 * entry point to start work on a single item
 * @param targetThreadId
 */
export async function doGdriveWorkByThreadIds(targetThreadId) {
  await _init();

  logger.info(`doGdriveWorkByThreadIds threadId=${targetThreadId}`);

  const matchedResults: DatabaseResponse<Email>[] = await Models.Email.findAll({
    where: {
      threadId: targetThreadId,
    },
    include: [
      {
        model: Models.Attachment,
        required: false,
      },
    ],
  });

  await _processMessages(_transformMatchedThreadsResults(matchedResults));
}

function _transformMatchedThreadsResults(matchedResults: any[]): Email[] {
  return matchedResults.map((matchedResult) => {
    const email = matchedResult.dataValues;
    email.Attachments = (email.Attachments || []).map((a) => a.dataValues);
    return email;
  });
}
