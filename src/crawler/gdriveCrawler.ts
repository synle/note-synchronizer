// @ts-nocheck
require("dotenv").config();
import axios from "axios";
import fs from "fs";
import { Email, DatabaseResponse, Attachment } from "../types";
import initDatabase from "../models/modelsFactory";
import Models from "../models/modelsSchema";
import { JSDOM } from "jsdom";
import {
  initGoogleApi,
  createDriveFolder,
  uploadFile,
  parseHtmlBody,
  parseHtmlTitle,
} from "../crawler/gmailCrawler";

import { logger } from "../loggers";

let noteDestinationFolderId;
const myEmails = (process.env.MY_EMAIL || "").split("|||");
const mySignatureTokens = (process.env.MY_SIGNATURE_TOKEN || "").split("|||");
const ignoredTokens = (process.env.IGNORED_TOKEN || "").split("|||");

const PROCESSED_EMAIL_PREFIX_PATH = "./processed";

const REGEX_URL = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/;

function _isStringUrl(string) {
  return (string.match(REGEX_URL) || []).length > 0;
}

function _extractUrlFromString(string) {
  return string.match(REGEX_URL)[0];
}

async function _crawlUrl(url) {
  try {
    const response = await axios(url).catch((err) => logger.debug(err));
    if (!response || response.status !== 200) {
      logger.error("> Error crawlUrl: ", url, response && response.status);
      return;
    }
    const rawHtmlBody = response.data;

    return {
      subject: parseHtmlTitle(rawHtmlBody) || "",
      body: rawHtmlBody,
    };
  } catch (e) {
    logger.error("> Error crawlUrl: ", url);
  }
}

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
  noteDestinationFolderId = await createDriveFolder(
    process.env.NOTE_DESTINATION_FOLDER_NAME,
    "Note Synchronizer Destination Folder"
  );

  logger.debug(
    `ID for Google Drive Note Sync Folder: ${noteDestinationFolderId}`
  );
}

async function _processMessages(messagesToProcess) {
  const totalMessageCount = messagesToProcess.length;
  logger.debug(" > Total Messages To Process:", totalMessageCount);

  let processedMessageCount = 0;

  for (let messageToProcess of messagesToProcess) {
    const email: Email = messageToProcess.dataValues;

    const percentDone = (
      (processedMessageCount / totalMessageCount) *
      100
    ).toFixed(2);
    if (
      percentDone === 0 ||
      percentDone % 20 === 0 ||
      processedMessageCount % 100 === 0
    ) {
      logger.debug(
        `> ${percentDone}% (${processedMessageCount}/${totalMessageCount})`
      );
    }
    processedMessageCount++;

    let { threadId, id, body, rawBody, from, bcc, to, subject, date } = email;
    const toEmailList = (bcc || "").split(",").concat((to || "").split(","));
    const attachments: Attachment[] = (email.Attachments || [])
      .map((a) => a.dataValues)
      .filter((attachment) => {
        // only use attachments that is not small images
        const attachmentStats = fs.statSync(attachment.path);
        return (
          attachmentStats.size < 30000 &&
          attachment.mimeType.includes("images/") === 0
        );
      });

    subject = (subject || "").trim();

    body = body || "";
    for (let signature of mySignatureTokens) {
      body = body.replace(signature, "");
    }
    body = body.trim();

    rawBody = (rawBody || "").trim();
    let docFileName = subject;

    const isEmailSentToMySelf =
      myEmails.some((myEmail) => from.includes(myEmail)) &&
      myEmails.some((myEmail) =>
        toEmailList.some((toEmail) => toEmail.includes(myEmail))
      );

    const hasSomeAttachments = attachments.length > 0;

    if (isEmailSentToMySelf || hasSomeAttachments) {
      if (_isStringUrl(subject)) {
        // if subject is a url
        const urlToCrawl = _extractUrlFromString(subject);

        // crawl the URL for title
        logger.debug(" > Crawling subject with url", id, urlToCrawl);
        const websiteRes = await _crawlUrl(urlToCrawl);

        if (websiteRes && websiteRes.subject) {
          subject = (websiteRes.subject || "").trim();
          body = `<a href='${urlToCrawl}'>${urlToCrawl}</a><hr />${websiteRes.body}`.trim();
        }
      } else if (body.length < 255 && _isStringUrl(body)) {
        // if body is a url
        const urlToCrawl = _extractUrlFromString(body);
        if (urlToCrawl) {
          // crawl the URL for title
          logger.debug(" > Crawling body with url", id, urlToCrawl);
          const websiteRes = await _crawlUrl(urlToCrawl);
          if (websiteRes && websiteRes.subject) {
            subject = `${subject} - ${websiteRes.subject || ""}`.trim();
            body = `<a href='${urlToCrawl}'>${urlToCrawl}</a><hr />${websiteRes.body}`.trim();
          }
        }
      } else {
        // anything else use raw body
        body = rawBody;
      }

      // ignored if content contains the ignored patterns
      if (
        ignoredTokens.some((ignoredToken) =>
          body.toLowerCase().includes(ignoredToken)
        ) ||
        ignoredTokens.some((ignoredToken) =>
          subject.toLowerCase().includes(ignoredToken)
        )
      ) {
        logger.debug(" > Skipped due to Ignored Pattern: ", subject);

        continue; // skipped
      }

      // upload the doc itself
      // only log email if there're some content
      if (body.length > 0) {
        const localPath = `${PROCESSED_EMAIL_PREFIX_PATH}/processed.${email.id}.data`;

        docFileName = _sanitizeFileName(subject);

        try {
          const fileContent = `
          <h1>${subject}</h1>
          <hr />
          <div><b><u>from:</u></b> ${from}</div>
          <div><b><u>threadId:</u></b> ${threadId}</div>
          <div><b><u>messageId:</u></b> ${id}</div>
          <hr />
          ${body}`.trim();
          fs.writeFileSync(localPath, fileContent.trim());

          logger.debug(`> Upload original note file ${docFileName}`);

          await uploadFile(
            docFileName,
            "text/html",
            localPath,
            `ThreadId=${threadId} MessageId=${id} Main Email`,
            date,
            noteDestinationFolderId
          );
        } catch (e) {
          logger.error(
            ` > Error - Failed ot original note - ThreadId=${threadId} MessageId=${id} attachmentName=${docFileName} ${
              attachment.mimeType
            } ${JSON.stringify(e, null, 2)}`
          );
        }
      }

      // then upload the associated attachments
      let AttachmentIdx = 0;
      for (let attachment of attachments) {
        AttachmentIdx++;
        const attachmentName = _sanitizeFileName(
          `${docFileName} - #${AttachmentIdx} - ${attachment.fileName}`
        );

        logger.debug(
          ` > Upload Attachment ThreadId=${threadId} MessageId=${id} attachmentName=${attachmentName} ${attachment.mimeType}`
        );

        try {
          await uploadFile(
            attachmentName,
            attachment.mimeType,
            attachment.path,
            `ThreadId=${threadId} MessageId=${id} Attachment #${AttachmentIdx}`,
            date,
            noteDestinationFolderId
          );
        } catch (e) {
          logger.error(
            ` > Error - Failed ot upload attachment - ThreadId=${threadId} MessageId=${id} attachmentName=${attachmentName} ${
              attachment.mimeType
            } ${JSON.stringify(e, null, 2)}`
          );
        }
      }
    } else {
      logger.debug(`Skipped thread=${threadId} id=${id} subject=${subject}`);
    }
  }
}

export async function doWorkForAllItems() {
  await _init();

  const matchedResults: DatabaseResponse<Email>[] = await Models.Email.findAll({
    where: {},
    include: [
      {
        model: Models.Attachment,
        required: false,
      },
    ],
  });

  await _processMessages(matchedResults);
}

/**
 * entry point to start work on a single item
 * @param targetThreadId
 */
export async function doWorkSingle(targetThreadId) {
  await _init();

  logger.debug(`Processing thread=${targetThreadId}`);

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

  await _processMessages(matchedResults);
}
