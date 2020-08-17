// @ts-nocheck
const { Readability } = require("@mozilla/readability");
const { Base64 } = require("js-base64");
const fs = require("fs");
const { JSDOM } = require("jsdom");
const moment = require("moment");

import { Email, Headers, GmailAttachmentResponse } from "../types";
import Models from "../models/modelsSchema";

import { logger } from "../loggers";
import {
  getThreadEmailsByThreadId,
  getThreadsByQuery,
  getEmailAttachment,
  searchDrive,
  createFileInDrive,
  updateFileInDrive,
  createFolderInDrive,
  flattenGmailPayloadParts,
} from "./googleApiUtils";

import {
  mySignatureTokens,
  isStringUrl,
  extractUrlFromString,
  crawlUrl,
  MimeTypeEnum,
} from "./commonUtils";

const useInMemoryCache = false;

// google crawler
const GMAIL_ATTACHMENT_PATH = "./attachments";
const GMAIL_PATH_THREAD_LIST = `./caches/gmail.threads.data`;
const GMAIL_PATH_THREAD_LIST_TOKEN = `./caches/gmail.threads_last_tokens.data`;

// crawler start

/**
 * api to get and process the list of message by a thread id
 * @param targetThreadId
 */
export function _processMessagesByThreadId(
  targetThreadId,
  inMemoryMapForMessages
): Promise<Email[]> {
  return new Promise(async (resolve, reject) => {
    // get from gmail api
    const attachments = [];

    let threadMessages;
    let foundFromDb = false;

    logger.debug(`Working on thread: ${targetThreadId}`);

    try {
      // attempting at getting it from the in memory map
      if (inMemoryMapForMessages && inMemoryMapForMessages.length > 0) {
        threadMessages = inMemoryMapForMessages;
        foundFromDb = true;
        logger.debug(
          `Threads Result from Memory: threadMessages=${threadMessages.length}`
        );
      }

      // attempting at getting the emails from the database
      if (!threadMessages) {
        const messagesFromDatabase = await Models.RawContent.findAll({
          where: {
            threadId: targetThreadId,
          },
        });

        logger.debug(`Threads Result from DB: ${messagesFromDatabase.length}`);

        if (messagesFromDatabase && messagesFromDatabase.length > 0) {
          threadMessages = messagesFromDatabase.map((message) =>
            JSON.parse(message.dataValues.rawApiResponse)
          );
          foundFromDb = true;
        }
      }

      // get emails from the database
      if (!threadMessages) {
        const { messages } = await getThreadEmailsByThreadId(targetThreadId);

        logger.debug(`Threads Result from API: ${messages.length}`);

        threadMessages = messages;
      }
    } catch (e) {
      logger.error(`Cannot fetch thread : threadId=${targetThreadId} : ${e}`);
    }

    logger.debug(
      `Found and start processing ${threadMessages.length} messages`
    );

    // persist things into the raw content db...
    for (let message of threadMessages) {
      const { id, threadId } = message;

      // store raw content
      if (foundFromDb !== true) {
        await Models.RawContent.create({
          messageId: id,
          threadId: threadId,
          rawApiResponse: JSON.stringify(message),
        }).catch((err) => {
          logger.error(
            `Insert raw content failed threadId=${threadId} id=${id} ${
              err.stack || JSON.stringify(err)
            }`
          );
        });
      }
    }

    // start processing
    for (let message of threadMessages) {
      try {
        const { id, threadId } = message;
        const messageDate = message.internalDate;

        let rawBody = "";
        const parts = flattenGmailPayloadParts(message.payload);
        if (parts && parts.length > 0) {
          for (let part of parts) {
            const { mimeType, partId } = part;

            const { size, attachmentId, data } = part.body;
            const fileName = part.filename;

            logger.debug(
              `Parsing Part of Message: threadId=${threadId} id=${id} partId=${partId} mimeType=${mimeType}`
            );

            if (size === 0) {
              // no body or data
              logger.debug(
                `Skipped Part: threadId=${threadId} id=${id} partId=${partId} mimeType=${mimeType}`
              );
              continue;
            } else if (attachmentId) {
              logger.debug(
                `Parsing Message Attachment: threadId=${threadId} id=${id} partId=${partId} mimeType=${mimeType}`
              );

              // is attachment, then download it
              const attachment = {
                mimeType,
                attachmentId,
                fileName,
              };
              const attachmentPath = await _parseGmailAttachment(
                id,
                attachment
              );

              attachments.push({
                id: attachment.attachmentId,
                threadId,
                messageId: id,
                mimeType: attachment.mimeType,
                fileName: attachment.fileName,
                path: attachmentPath,
                headers: JSON.stringify(_getHeaders(part.headers || [])),
              });
            } else {
              // regular file
              logger.debug(`Parse Message: ${mimeType}`);
              switch (mimeType) {
                case "multipart/alternative":
                case "multipart/related":
                  logger.error(
                    `Unsupported mimetype threadId=${threadId} id=${id} partId=${partId} mimeType=${mimeType}`
                  );
                  break;

                default:
                case "image/png":
                case "image/jpg":
                case "image/jpeg":
                case "image/gif":
                  const inlineFileName =
                    fileName || `parts.${threadId}.${id}.${partId}`;

                  const newFilePath = `${GMAIL_ATTACHMENT_PATH}/${inlineFileName}`;
                  _saveBase64DataToFile(newFilePath, data);

                  attachments.push({
                    id: inlineFileName,
                    threadId,
                    messageId: id,
                    mimeType: mimeType,
                    fileName: inlineFileName,
                    path: newFilePath,
                    headers: JSON.stringify(_getHeaders(part.headers || [])),
                  });
                  break;

                case "text/plain":
                  if (!rawBody) {
                    // only store the rawbody if it's not already defined
                    rawBody = _parseGmailMessage(data);
                  }
                  break;

                case "text/x-amp-html":
                case "text/html":
                  rawBody = _parseGmailMessage(data);
                  break;
              }
            }
          }
        }

        const headers: Headers = _getHeaders(message.payload.headers || []);

        const from = _parseEmailAddress(headers.from) || headers.from;

        const to = _parseEmailAddressList(headers.to);

        const bcc = _parseEmailAddressList(headers.bcc);

        const rawSubject = (headers.subject || "").trim();

        const date = new Date(headers.date).getTime() || messageDate;

        // see if we need to handle further fetching from here
        // here we might face body of a url or subject of a url
        let subject = rawSubject;
        let body =
          parseHtmlBody(rawBody) ||
          parseHtmlBodyWithoutParser(rawBody) ||
          rawBody; // attempt at using one of the parser;

        // trim the signatures
        for (let signature of mySignatureTokens) {
          body = body.replace(signature, "");
        }
        body = body.trim();

        if (isStringUrl(subject)) {
          // if subject is a url
          const urlToCrawl = extractUrlFromString(subject);

          // crawl the URL for title
          logger.debug(`Crawling subject with url: id=${id} ${urlToCrawl}`);
          const websiteRes = await crawlUrl(urlToCrawl);

          if (websiteRes && websiteRes.subject) {
            subject = (websiteRes.subject || "").trim();
            body = `<a href='${urlToCrawl}'>${urlToCrawl}</a><hr />${websiteRes.body}`.trim();
          } else {
            logger.debug(`Crawl failed for id=${id} url${urlToCrawl}`);
            body = `<a href='${urlToCrawl}'>${urlToCrawl}</a><hr /><h2>404_Page_Not_Found</h2>`.trim();
          }
        } else if (body.length < 255 && isStringUrl(body)) {
          // if body is a url
          const urlToCrawl = extractUrlFromString(body);
          if (urlToCrawl) {
            // crawl the URL for title
            logger.debug(`Crawling body with url: id=${id} ${urlToCrawl}`);
            const websiteRes = await crawlUrl(urlToCrawl);
            if (websiteRes && websiteRes.subject) {
              subject = `${subject} - ${websiteRes.subject || ""}`.trim();
              body = `<a href='${urlToCrawl}'>${urlToCrawl}</a><hr />${websiteRes.body}`.trim();
            } else {
              logger.debug(`Crawl failed for id=${id} url${urlToCrawl}`);
              body = `<a href='${urlToCrawl}'>${urlToCrawl}</a><hr /><h2>404_Page_Not_Found</h2>`.trim();
            }
          }
        } else {
          body = rawBody;
        }

        const messageToUse = {
          id,
          threadId,
          from: from || null,
          body: body || null,
          rawBody: rawBody || null,
          subject: subject || null,
          rawSubject: rawSubject || null,
          headers: JSON.stringify(headers),
          to: to.join(",") || null,
          bcc: bcc.join(",") || null,
          date,
        };

        // store the message itself
        logger.debug(
          `Saving message: threadId=${threadId} id=${id} subject=${subject}`
        );
        await Models.Email.create(messageToUse).catch((err) => {
          // attempt to do update
          logger.debug(
            `Inserting email failed, trying updating threadId=${threadId} id=${id} ${
              err.stack || JSON.stringify(err)
            }`
          );
          return Models.Email.update(messageToUse, {
            where: {
              id: messageToUse.id,
            },
          }).catch((err) => {
            logger.error(
              `Upsert email failed threadId=${threadId} id=${id} ${
                err.stack || JSON.stringify(err)
              }`
            );
          });
        });
      } catch (err) {
        logger.error(
          `Failed to process threadId=${threadId} id=${id}   error=${
            err.stack || JSON.stringify(err)
          }`
        );
      }
    }

    // save attachments
    logger.debug(
      `Saving ${attachments.length} attachments threadId=${targetThreadId}`
    );
    for (let attachment of attachments) {
      // note we don't block sql database here...
      Models.Attachment.create(attachment).catch((err) => {
        // attempt to do update
        logger.debug(
          `Insert attachment failed, trying to do update instead threadId=${
            attachment.threadId
          } id=${attachment.messageId} attachmentId=${attachment.id} ${
            err.stack || JSON.stringify(err)
          }`
        );
        return Models.Attachment.update(attachment, {
          where: {
            id: attachment.id,
          },
        }).catch((err) => {
          logger.error(
            `Upsert email attachment failed threadId=${
              attachment.threadId
            } id=${attachment.messageId} attachmentId=${attachment.id} ${
              err.stack || JSON.stringify(err)
            }`
          );
        });
      });
    }

    logger.debug(`Done processing threadId=${targetThreadId}`);

    resolve(threadMessages.length);
  });
}

/**
 * parse a list of emails
 * @param emailAddressesAsString
 */
function _parseEmailAddressList(emailAddressesAsString) {
  emailAddressesAsString = (emailAddressesAsString || "").toLowerCase();
  return emailAddressesAsString
    .split(/[ ]/g)
    .filter((email) => !!email)
    .map((emailAddress) => {
      if (emailAddress.includes("@")) {
        try {
          return _parseEmailAddress(emailAddress);
        } catch (e) {
          logger.error(
            `Cannot parse email address list: ${emailAddress} : ${e}`
          );
          return emailAddress;
        }
      }
    })
    .filter((email) => !!email && email.includes("@"));
}

/**
 * parse a single email
 * @param emailAddress
 */
function _parseEmailAddress(emailAddress) {
  try {
    return emailAddress
      .match(/<?[a-zA-Z0-9-_\.]+@[a-zA-Z0-9-_\.]+>?/)[0]
      .replace(/<?>?/g, "")
      .toLowerCase()
      .trim();
  } catch (e) {
    logger.error(`Cannot parse email: ${emailAddress}`);
    return null;
  }
}

/**
 * get a list of threads to process
 */
async function _getThreadIdsToProcess() {
  try {
    return JSON.parse(fs.readFileSync(GMAIL_PATH_THREAD_LIST));
  } catch (GMAIL_PATH_THREAD_LIST_TOKEN) {
    // not in cache
    logger.info("> Not found in cache, start fetching thread list");
    return [];
  }
}

async function _pollNewEmailThreads(q = "") {
  let countPageProcessed = 0;
  let pageToken = "";
  let threadIds = [];

  try {
    threadIds = JSON.parse(fs.readFileSync(GMAIL_PATH_THREAD_LIST));
  } catch (GMAIL_PATH_THREAD_LIST_TOKEN) {
    // not in cache
    logger.info("> Not found in cache, start fetching thread list");
  }

  try {
    pageToken = fs
      .readFileSync(GMAIL_PATH_THREAD_LIST_TOKEN, "UTF-8")
      .split("\n")
      .map((r) => r.trim())
      .filter((r) => !!r);
    pageToken = pageToken[pageToken.length - 1] || "";
  } catch (e) {}

  let countTotalPagesToCrawl = process.env.GMAIL_PAGES_TO_CRAWL || 1;
  logger.info(
    `Crawl list of email threads: maxPages=${countTotalPagesToCrawl} lastToken=${pageToken}`
  );

  let allThreads = [];

  while (countPageProcessed < countTotalPagesToCrawl) {
    countPageProcessed++;

    try {
      const { threads, nextPageToken } = await getThreadsByQuery(q, pageToken);
      allThreads = [...allThreads, ...(threads || []).map((r) => r.id)];
      pageToken = nextPageToken;

      if (!nextPageToken) {
        break;
      }

      fs.appendFileSync(GMAIL_PATH_THREAD_LIST_TOKEN, nextPageToken + "\n");

      if (countPageProcessed % 25 === 0 && countPageProcessed > 0) {
        logger.info(`${countPageProcessed} pages crawled so far`);
      }
    } catch (err) {
      logger.error(
        `Failed to get thread list pageToken=${pageToken}  error=${err.stack}`
      );
      break;
    }
  }

  // remove things we don't need
  const foundIds = {};
  threadIds = [...threadIds, ...allThreads].filter((threadId) => {
    if (foundIds[threadId]) {
      return false; // don't include duplicate
    }
    foundIds[threadId] = true;
    return true;
  });

  // cache it
  fs.writeFileSync(GMAIL_PATH_THREAD_LIST, JSON.stringify(threadIds, null, 2));

  return allThreads;
}

/**
 * remove all script and styles
 * @param string
 */
export function _cleanHtml(string) {
  return string
    .replace(
      /<style( type="[a-zA-Z/+]+")?>[a-zA-Z0-9-_!*{:;}#.%,[^=\]@() \n\t\r"'/ŤŮ>?&~+µ]+<\/style>/gi,
      ""
    )
    .replace(
      /style=["'][a-zA-Z0-9-_!*{:;}#.%,[^=\]@() \n\t\r"'/ŤŮ>?&~+µ]+["']/gi,
      ""
    )
    .replace(
      /<script( type="[a-zA-Z/+]+")?>[a-zA-Z0-9-_!*{:;}#.%,[^=\]@() \n\t\r"'/ŤŮ>?&~+µ]+<\/script>/gi,
      ""
    );
}

/**
 * parse gmail email body
 * @param bodyData
 */
export function _parseGmailMessage(bodyData) {
  return Base64.decode(
    (bodyData || "").replace(/-/g, "+").replace(/_/g, "/")
  ).trim();
}

export function parseHtmlBodyWithoutParser(html) {
  let body = html || "";
  try {
    const dom = new JSDOM(_cleanHtml(html));
    body = dom.window.document.body.textContent;
  } catch (e) {}

  try {
    return body
      .replace("\r", "\n")
      .split(/[ ]/)
      .map((r) => r.trim())
      .filter((r) => !!r)
      .join(" ")
      .split("\n")
      .map((r) => r.trim())
      .filter((r) => !!r)
      .join("\n")
      .trim();
  } catch (e) {
    return body;
  }
}

export function parseHtmlBody(html) {
  try {
    const dom = new JSDOM(_cleanHtml(html));
    return new JSDOM(
      new Readability(dom.window.document).parse().content
    ).window.document.body.textContent.trim();
  } catch (e) {}
}

export function parseHtmlTitle(html) {
  try {
    const dom = new JSDOM(html);
    return dom.window.document.title.trim();
  } catch (e) {}
}

export async function _parseGmailAttachment(
  messageId,
  attachment: GmailAttachmentResponse
) {
  const newFilePath = `${GMAIL_ATTACHMENT_PATH}/${messageId}.${attachment.fileName}`;

  // check if the attachment already been downloaded
  let hasDownloaded = false;
  try {
    if (fs.existsSync(newFilePath)) {
      hasDownloaded = true;
    }
  } catch (e) {}

  if (hasDownloaded !== true) {
    logger.debug(`Download Gmail attachment from API: ${newFilePath}`);

    // if not, then download from upstream
    const attachmentResponse = await getEmailAttachment(
      messageId,
      attachment.attachmentId
    );

    _saveBase64DataToFile(newFilePath, attachmentResponse);

    return newFilePath;
  } else {
    logger.debug(`Skipped Downloading attachment: ${newFilePath}`);
    return newFilePath; // null indicated that we don't need to download, and ignored this entry entirely
  }
}

function _saveBase64DataToFile(newFilePath, base64Data) {
  try {
    fs.writeFileSync(
      newFilePath,
      (base64Data || "").replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
      function (err) {
        logger.info(err);
      }
    );
  } catch (e) {
    logger.error(`Error cannot save binary: ${newFilePath}`);
  }
}

function _getHeaders(headers) {
  return headers.reduce((res, header) => {
    res[header.name.toLowerCase()] = header.value;
    return res;
  }, {});
}

async function _processEmails(threadIds, inMemoryLookupContent = {}) {
  threadIds = [].concat(threadIds || []);

  const countTotalThreads = threadIds.length;
  logger.info(`Total Threads: ${countTotalThreads}`);

  let totalMsgCount = 0;
  let countProcessedThread = 0;
  for (let threadId of threadIds) {
    const percentDone = (
      (countProcessedThread / countTotalThreads) *
      100
    ).toFixed(2);

    if (
      countProcessedThread % 100 === 0 ||
      (percentDone % 20 === 0 && percentDone > 0)
    ) {
      logger.info(
        `${percentDone}% (${countProcessedThread} / ${countTotalThreads})`
      );
    }
    countProcessedThread++;

    // search for the thread
    const processedMessageCount = await _processMessagesByThreadId(
      threadId,
      inMemoryLookupContent[threadId]
    );
    totalMsgCount += processedMessageCount;
  }

  logger.info(`Total Messages: ${totalMsgCount}`);
}

export async function uploadFile(
  name,
  mimeType,
  localPath,
  description,
  dateEpochTime,
  parentFolderId = process.env.NOTE_GDRIVE_FOLDER_ID
) {
  mimeType = mimeType.toLowerCase();
  switch (mimeType) {
    case MimeTypeEnum.TEXT_PLAIN:
    case MimeTypeEnum.TEXT_XML:
    case MimeTypeEnum.APP_XML:
    case MimeTypeEnum.APP_JSON:
      mimeType = MimeTypeEnum.TEXT_PLAIN;
      break;
  }

  let mimeTypeToUse = "";
  if (
    [
      MimeTypeEnum.TEXT_CSV,
      MimeTypeEnum.APP_MS_XLS,
      MimeTypeEnum.APP_MS_XLSX,
    ].includes(mimeType)
  ) {
    mimeTypeToUse = MimeTypeEnum.APP_GOOGLE_SPREADSHEET;
  } else if (
    [
      MimeTypeEnum.APP_MS_DOC,
      MimeTypeEnum.APP_MS_DOCX,
      MimeTypeEnum.TEXT_PLAIN,
      MimeTypeEnum.TEXT_X_AMP_HTML,
      MimeTypeEnum.TEXT_HTML,
    ].includes(mimeType)
  ) {
    mimeTypeToUse = MimeTypeEnum.APP_GOOGLE_DOCUMENT;
  } else if (
    [MimeTypeEnum.APP_MS_PPT, MimeTypeEnum.APP_MS_PPTX].includes(mimeType)
  ) {
    mimeTypeToUse = MimeTypeEnum.APP_GOOGLE_PRESENTATION;
  } else {
    mimeTypeToUse = mimeType;
  }

  const createdTime = moment.utc(dateEpochTime).format("YYYY-MM-DDTHH:mm:ssZ");
  const modifiedTime = moment.utc(dateEpochTime).format("YYYY-MM-DDTHH:mm:ssZ");

  // refer to this link for more metadata
  // https://developers.google.com/drive/api/v3/reference/files/create
  const fileGDriveMetadata = {
    name,
    parents: [parentFolderId],
    mimeType: mimeTypeToUse,
    modifiedTime,
    createdTime,
    description,
  };

  const media = {
    mimeType,
    body: fs.createReadStream(localPath),
  };

  const matchedResults = await searchDrive(
    fileGDriveMetadata.name,
    fileGDriveMetadata.mimeType,
    parentFolderId
  );
  if (matchedResults.length === 0) {
    logger.debug("Upload file with create operation", name);
    return createFileInDrive(fileGDriveMetadata, media);
  } else {
    logger.debug(
      "Upload file with update operation",
      name,
      matchedResults[0].id
    );
    return updateFileInDrive(matchedResults[0].id, fileGDriveMetadata, media);
  }
}

export async function createDriveFolder(name, description, parentFolderId) {
  const mimeType = MimeTypeEnum.APP_GOOGLE_FOLDER;

  const matchedResults = await searchDrive(name, mimeType);
  if (matchedResults.length === 0) {
    const fileGDriveMetadata = {
      name,
      mimeType,
      description,
    };

    if (parentFolderId) {
      fileGDriveMetadata.parents = [parentFolderId];
    }

    // create the folder itself
    return (await createFolderInDrive(fileGDriveMetadata)).id;
  } else {
    return matchedResults[0].id;
  }
}

/**
 * entry point to start work on all items
 */
export async function doGmailWorkForAllItems() {
  logger.info(`doGmailWorkForAllItems`);

  const threadIds = await _getThreadIdsToProcess();

  // attempting at getting the emails from the database
  let inMemoryLookupContent = {};
  if (useInMemoryCache) {
    logger.info(`Constructing in-memory lookup for messages`);
    try {
      const messagesFromDatabase = await Models.RawContent.findAll({});
      if (messagesFromDatabase && messagesFromDatabase.length > 0) {
        messagesFromDatabase.forEach((message) => {
          inMemoryLookupContent[message.threadId] =
            inMemoryLookupContent[message.threadId] || [];
          inMemoryLookupContent[message.threadId].push(
            JSON.parse(message.dataValues.rawApiResponse)
          );
        });
      }
    } catch (e) {}

    logger.info(
      `Size of in-memory lookup for messages: ${
        Object.keys(inMemoryLookupContent).length
      }`
    );
  }

  return _processEmails(threadIds, inMemoryLookupContent);
}

/**
 * entry point to start work on a single item
 * @param targetThreadId
 */
export async function doGmailWorkByThreadIds(targetThreadId) {
  logger.info(`doGmailWorkByThreadIds ${targetThreadId}`);
  return _processEmails(targetThreadId);
}

/**
 * This is simply to get a list of all email threadIds
 */
export async function doGmailWorkPollThreadList() {
  logger.info(`doGmailWorkPollThreadList`);

  // get emails from inbox
  logger.info(`Get threads from Inbox / All Mails`);
  await _pollNewEmailThreads();

  // get emails sent by me
  logger.info(`Get threads from emails sent by me`);
  await _pollNewEmailThreads("from:(me)");

  // get emails in draft
  logger.info(`Get threads from Draft Folders`);
  await _pollNewEmailThreads("in:drafts");
}
