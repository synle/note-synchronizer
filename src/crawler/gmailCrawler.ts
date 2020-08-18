// @ts-nocheck
const { Readability } = require("@mozilla/readability");
const { Base64 } = require("js-base64");
import fs from "fs";
const { JSDOM } = require("jsdom");
const { chunk } = require("lodash");
const prettier = require("prettier");
import { Op } from "sequelize";

import { Email, Headers, GmailAttachmentResponse } from "../types";
import Models from "../models/modelsSchema";

import { logger } from "../loggers";
import {
  getThreadEmailsByThreadId,
  getThreadsByQuery,
  getEmailAttachment,
  flattenGmailPayloadParts,
} from "./googleApiUtils";

import {
  mySignatureTokens,
  isStringUrl,
  extractUrlFromString,
  crawlUrl,
  MIME_TYPE_ENUM,
  THREAD_JOB_STATUS,
} from "./commonUtils";

const useInMemoryCache =
  process.env.USE_IN_MEMORY_CACHE_FOR_CONTENT === true || false; // whether or not to build up the map in memory

// google crawler
const MAX_CONCURRENT_THREAD_QUEUE =
  parseInt(process.env.MAX_CONCURRENT_THREAD_QUEUE) || 10;

const GMAIL_ATTACHMENT_PATH = "./attachments";
const GMAIL_PATH_THREAD_LIST_TOKEN = `./caches/gmail.threads_last_tokens.data`;

const MAX_TIME_PER_THREAD = 120000;
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
    const attachmentDownloadsPromises = []; // promises to keep track of attachment async download
    const attachmentsToSave = [];
    const messagesToSave = [];
    const startTime = Date.now();
    let ignoreTimerForTimeout = false;

    setTimeout(async () => {
      if (ignoreTimerForTimeout !== false) {
        return;
      }

      logger.error(
        `Aborted working on thread due to Timeout issues: threadId=${targetThreadId} totalMessages=${threadMessages.length}`
      );

      // update the process time and status to error timeout
      await Models.Thread.update(
        {
          processedDate: null,
          duration: Date.now() - startTime,
          totalMessages: threadMessages.length,
          status: THREAD_JOB_STATUS.ERROR_TIMEOUT,
        },
        {
          where: {
            threadId: targetThreadId,
          },
        }
      );

      reject("Timeout for task");
    }, MAX_TIME_PER_THREAD);

    let threadMessages = [];
    let foundRawEmailsFromDbOrCache = false;

    logger.debug(`Start working on thread: threadId=${targetThreadId}`);

    try {
      // attempting at getting it from the in memory map
      if (inMemoryMapForMessages && inMemoryMapForMessages.length > 0) {
        threadMessages = inMemoryMapForMessages;
        foundRawEmailsFromDbOrCache = true;
        logger.debug(
          `Threads Result from Memory threadId=${targetThreadId}: threadMessages=${threadMessages.length}`
        );
      }

      // attempting at getting the emails from the database
      if (threadMessages.length === 0) {
        const messagesFromDatabase = await Models.RawContent.findAll({
          where: {
            threadId: targetThreadId,
          },
        });

        logger.debug(
          `Threads Result from DB threadId=${targetThreadId}: ${messagesFromDatabase.length}`
        );

        if (messagesFromDatabase && messagesFromDatabase.length > 0) {
          threadMessages = messagesFromDatabase.map((message) =>
            JSON.parse(message.dataValues.rawApiResponse)
          );
          foundRawEmailsFromDbOrCache = true;
        }
      }

      // get emails from the database
      if (threadMessages.length === 0) {
        const { messages } = await getThreadEmailsByThreadId(targetThreadId);

        logger.debug(
          `Threads Result from API threadId=${targetThreadId}: ${messages.length}`
        );

        threadMessages = messages;
      }
    } catch (e) {
      logger.error(`Cannot fetch thread : threadId=${targetThreadId} : ${e}`);
    }

    if (threadMessages.length === 0) {
      logger.error(
        `Aborted working on thread No messages found with this threadId: threadId=${targetThreadId}`
      );

      ignoreTimerForTimeout = true; // clear the timeout timer

      Models.Thread.update(
        {
          processedDate: null,
          duration: Date.now() - startTime,
          totalMessages: threadMessages.length,
          status: THREAD_JOB_STATUS.ERROR_THREAD_NOT_FOUND,
        },
        {
          where: {
            threadId: targetThreadId,
          },
        }
      );

      return resolve(threadMessages.length);
    }

    logger.debug(
      `Found and start processing threadId=${targetThreadId} totalMessages=${threadMessages.length}`
    );

    // persist things into the raw content db...
    for (let message of threadMessages) {
      const { id, threadId } = message;

      // store raw content
      if (foundRawEmailsFromDbOrCache !== true) {
        // look for parts and parse it. Do decode base 64 of parts
        const parts = flattenGmailPayloadParts(message.payload);
        if (parts && parts.length > 0) {
          for (let part of parts) {
            if (part.body.data) {
              part.body.data = _parseGmailMessage(part.body.data);
            }
          }
        }

        await Models.RawContent.create({
          messageId: id,
          threadId: threadId,
          rawApiResponse: JSON.stringify(message),
          date: message.internalDate || Date.now(),
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
        const { id, threadId, labelIds } = message;
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
                `Download Message Attachment Async: threadId=${threadId} id=${id} partId=${partId} mimeType=${mimeType} attachmentId=${attachmentId}`
              );

              // is attachment, then download it
              const attachment = {
                mimeType,
                attachmentId,
                fileName,
              };

              // download attachment async
              attachmentDownloadsPromises.push(
                _parseGmailAttachment(id, attachment)
                  .then((attachmentPath) => {
                    attachmentsToSave.push({
                      id: attachment.attachmentId,
                      threadId,
                      messageId: id,
                      mimeType: attachment.mimeType,
                      fileName: attachment.fileName,
                      path: attachmentPath,
                      headers: JSON.stringify(_getHeaders(part.headers || [])),
                    });
                  })
                  .catch((err) => {
                    logger.error(
                      `Download Message Attachment Async Failed: threadId=${threadId} id=${id} partId=${partId} mimeType=${mimeType} attachmentId=${attachmentId} ${err}`
                    );
                  })
              );
            } else {
              // regular file
              logger.debug(
                `Parsing Message as Raw Content: threadId=${threadId} id=${id} partId=${partId}`
              );

              switch (mimeType) {
                case MIME_TYPE_ENUM.MULTIPART_ALTERNATIVE:
                case MIME_TYPE_ENUM.MULTIPART_RELATED:
                  logger.error(
                    `Unsupported mimetype threadId=${threadId} id=${id} partId=${partId} mimeType=${mimeType}`
                  );
                  break;

                default:
                case MIME_TYPE_ENUM.IMAGE_GIF:
                case MIME_TYPE_ENUM.IMAGE_PNG:
                case MIME_TYPE_ENUM.IMAGE_JPG:
                case MIME_TYPE_ENUM.IMAGE_JPEG:
                  // this is inline attachment, no need to download it
                  logger.debug(
                    `Storing Inline Attachment: threadId=${threadId} id=${id} partId=${partId} mimeType=${mimeType}`
                  );

                  const inlineFileName =
                    fileName || `parts.${threadId}.${id}.${partId}`;

                  const newFilePath = `${GMAIL_ATTACHMENT_PATH}/${inlineFileName}`;

                  _saveBase64DataToFile(newFilePath, data);

                  attachmentsToSave.push({
                    id: inlineFileName,
                    threadId,
                    messageId: id,
                    mimeType: mimeType,
                    fileName: inlineFileName,
                    path: newFilePath,
                    headers: JSON.stringify(_getHeaders(part.headers || [])),
                  });
                  break;

                case MIME_TYPE_ENUM.TEXT_PLAIN:
                  if (!rawBody) {
                    // only store the rawbody if it's not already defined
                    rawBody = data;
                  }
                  break;

                case MIME_TYPE_ENUM.TEXT_X_AMP_HTML:
                case MIME_TYPE_ENUM.TEXT_HTML:
                  rawBody = _prettifyHtml(data);
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

        // stripped down body (remove signatures and clean up the dom)
        let strippedDownBody =
          parseHtmlBody(rawBody) ||
          parseHtmlBodyWithoutParser(rawBody) ||
          rawBody; // attempt at using one of the parser;

        // trim the signatures
        for (let signature of mySignatureTokens) {
          strippedDownBody = strippedDownBody.replace(signature, "");
        }
        strippedDownBody = strippedDownBody.trim();

        let body = strippedDownBody;

        if (isStringUrl(subject)) {
          // if subject is a url
          const urlToCrawl = extractUrlFromString(subject);

          // crawl the URL for title
          logger.debug(`Crawling subject with url: id=${id} ${urlToCrawl}`);
          const websiteRes = await crawlUrl(urlToCrawl);

          if (websiteRes && websiteRes.subject) {
            subject = (websiteRes.subject || "").trim();
            body = `<a href='${urlToCrawl}'>${urlToCrawl}</a><hr />${_prettifyHtml(
              websiteRes.body
            )}`.trim();
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
              body = `<a href='${urlToCrawl}'>${urlToCrawl}</a><hr />${_prettifyHtml(
                websiteRes.body
              )}`.trim();
            } else {
              logger.debug(`Crawl failed for id=${id} url${urlToCrawl}`);
              body = `<a href='${urlToCrawl}'>${urlToCrawl}</a><hr /><h2>404_Page_Not_Found</h2>`.trim();
            }
          }
        } else {
          body = strippedDownBody;
        }

        const messageToSave = {
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
          labelIds: (labelIds || []).join(",") || null,
        };

        logger.debug(
          `Pushing message to buffer: threadId=${threadId} id=${id} subject=${subject}`
        );

        messagesToSave.push(messageToSave);
      } catch (err) {
        logger.error(
          `Failed to process threadId=${targetThreadId} error=${
            err.stack || JSON.stringify(err)
          }`
        );
      }
    }

    // save messages
    logger.debug(
      `Saving messages: threadId=${targetThreadId} total=${messagesToSave.length}`
    );
    await Models.Email.bulkCreate(messagesToSave, {
      updateOnDuplicate: [
        "from",
        "body",
        "rawBody",
        "subject",
        "rawSubject",
        "headers",
        "to",
        "bcc",
        "date",
      ],
    }).catch((err) => {
      logger.debug(
        `Inserting emails failed threadId=${targetThreadId} ${
          err.stack || JSON.stringify(err)
        }`
      );
    });

    // save attachments
    await Promise.all(attachmentDownloadsPromises); // waiting for attachment to download

    ignoreTimerForTimeout = true; // clear the timeout timer

    logger.debug(
      `Saving attachments: threadId=${targetThreadId} totalAttachments=${attachmentsToSave.length} totalDownloadJobs=${attachmentDownloadsPromises.length}`
    );

    await Models.Attachment.bulkCreate(attachmentsToSave, {
      updateOnDuplicate: ["mimeType", "fileName", "path", "headers"],
    }).catch((err) => {
      logger.error(
        `Bulk create attachment failed, trying to do update instead threadId=${targetThreadId} ${
          err.stack || JSON.stringify(err)
        }`
      );
    });

    logger.debug(`Done processing threadId=${targetThreadId}`);

    await Models.Thread.update(
      {
        processedDate: Date.now(),
        duration: Date.now() - startTime,
        totalMessages: threadMessages.length,
        status: THREAD_JOB_STATUS.SUCCESS,
      },
      {
        where: {
          threadId: targetThreadId,
        },
      }
    );

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
    const databaseResponse = await Models.Thread.findAll({
      where: {
        processedDate: {
          [Op.eq]: null,
        },
      },
      order: [
        ["updatedAt", "DESC"], // start with the one that changes recenty
      ],
    });
    return databaseResponse.map(({ threadId }) => threadId);
  } catch (err) {
    // not in cache
    logger.info("Not found in cache, start fetching thread list");
    return [];
  }
}

async function _getRawContentsFromDatabase() {
  // attempting at getting the emails from the database
  let inMemoryLookupContent = {};
  if (useInMemoryCache) {
    logger.warn(`Constructing in-memory lookup for messages`);
    try {
      const messagesFromDatabase = await Models.RawContent.findAll({});
      if (messagesFromDatabase && messagesFromDatabase.length > 0) {
        for (let message of messagesFromDatabase) {
          inMemoryLookupContent[message.threadId] =
            inMemoryLookupContent[message.threadId] || [];
          inMemoryLookupContent[message.threadId].push(
            JSON.parse(message.dataValues.rawApiResponse)
          );
        }
      }
    } catch (e) {}

    logger.warn(
      `Size of in-memory lookup for messages: ${
        Object.keys(inMemoryLookupContent).length
      }`
    );
  }

  return inMemoryLookupContent;
}

async function _pollNewEmailThreads(q = "") {
  const startTime = Date.now();

  let countPageProcessed = 0;
  let pageToken = "";
  let threadIds = [];

  try {
    pageToken = fs
      .readFileSync(GMAIL_PATH_THREAD_LIST_TOKEN, "UTF-8")
      .split("\n")
      .map((r) => r.trim())
      .filter((r) => !!r);
    pageToken = pageToken[pageToken.length - 1] || "";
  } catch (e) {}

  let countTotalPagesToCrawl = process.env.GMAIL_PAGES_TO_CRAWL || 1;

  logger.warn(
    `Crawl list of email threads: q=${q} maxPages=${countTotalPagesToCrawl} lastToken=${pageToken}`
  );

  while (countPageProcessed < countTotalPagesToCrawl) {
    countPageProcessed++;

    try {
      const { threads, nextPageToken } = await getThreadsByQuery(q, pageToken);
      threadIds = [...threadIds, ...(threads || [])];
      pageToken = nextPageToken;

      if (!nextPageToken) {
        break;
      }

      fs.appendFileSync(GMAIL_PATH_THREAD_LIST_TOKEN, nextPageToken + "\n");

      if (countPageProcessed % 25 === 0 && countPageProcessed > 0) {
        logger.warn(
          `So far, ${countPageProcessed} pages crawled  q=${q}: ${threadIds.length} threads found`
        );
      }
    } catch (err) {
      logger.error(
        `Failed to get thread list q=${q} pageToken=${pageToken} error=${err.stack}`
      );
      break;
    }
  }

  logger.warn(`${countPageProcessed} total pages crawled:  q=${q}`);

  // store them into the database as chunks
  const threadIdsChunks = chunk(threadIds, 50); // maximum page size
  for (let threadIdsChunk of threadIdsChunks) {
    await Models.Thread.bulkCreate(
      threadIdsChunk.map(({ id, historyId, snippet }) => ({
        threadId: id,
        historyId,
        snippet,
        // this is to re-trigger the thread fetch, basically we want to reprocess this...
        processedDate: null,
        duration: null,
        totalMessages: null,
        status: THREAD_JOB_STATUS.PENDING,
      })),
      {
        updateOnDuplicate: ["processedDate"],
      }
    ).catch(() => {});
  }

  logger.warn(
    `Done Crawl list of email threads: q=${q} duration=${
      Date.now() - startTime
    }`
  );
}

/**
 * remove all script and styles
 * @param string
 */
export function _cleanHtml(string) {
  return string.replace(
    /<style( type="[a-zA-Z/+]+")?>[a-zA-Z0-9-_!*{:;}#.%,[^=\]@() \n\t\r"'/ŤŮ>?&~+µ]+<\/style>/gi,
    ""
  );
}

function _prettifyHtml(bodyHtml) {
  try {
    return prettier.format(bodyHtml, { parser: "html" });
  } catch (e) {}

  return bodyHtml;
}

/**
 * parse gmail email body
 * @param bodyData
 */
export function _parseGmailMessage(bodyData) {
  return Base64.decode((bodyData || "").replace(/-/g, "+").replace(/_/g, "/"))
    .trim()
    .replace("\r\n", "");
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
    const dom = new JSDOM(_cleanHtml(html));
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
        logger.info(`Failed _saveBase64DataToFile ${newFilePath} ${err}`);
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

  let actionPromisesPool = [];
  let threadIdsPool = [];

  for (let threadId of threadIds) {
    const percentDone = (
      (countProcessedThread / countTotalThreads) *
      100
    ).toFixed(2);

    if (
      countProcessedThread % 250 === 0 ||
      (percentDone % 20 === 0 && percentDone > 0)
    ) {
      logger.info(
        `${percentDone}% (${countProcessedThread} / ${countTotalThreads})`
      );
    }
    countProcessedThread++;

    // search for the thread
    actionPromisesPool.push(
      _processMessagesByThreadId(
        threadId,
        inMemoryLookupContent[threadId]
      ).then(
        (processedMessageCount) => (totalMsgCount += processedMessageCount)
      )
    );

    threadIdsPool.push(threadId);

    if (actionPromisesPool.length === MAX_CONCURRENT_THREAD_QUEUE) {
      logger.debug(
        `Waiting for threads to be processed: \n${threadIdsPool.join("\n")}`
      );

      await Promise.allSettled(actionPromisesPool);
      actionPromisesPool = [];
      threadIdsPool = [];
    }
  }

  logger.info(`Total Messages: ${totalMsgCount}`);
}

/**
 * entry point to start work on all items
 */
export async function doGmailWorkForAllItems() {
  logger.warn(`doGmailWorkForAllItems`);

  const threadIds = await _getThreadIdsToProcess();

  const inMemoryLookupContent = await _getRawContentsFromDatabase();

  await _processEmails(threadIds, inMemoryLookupContent);

  logger.warn("Done doGmailWorkForAllItems");
}

/**
 * entry point to start work on a single item
 * @param targetThreadId
 */
export async function doGmailWorkByThreadIds(targetThreadId) {
  logger.warn(`doGmailWorkByThreadIds ${targetThreadId}`);
  await _processEmails(targetThreadId);
  logger.warn(`Done doGmailWorkByThreadIds ${targetThreadId}`);
}

/**
 * This is simply to get a list of all email threadIds
 */
export async function doGmailWorkPollThreadList() {
  logger.warn(`doGmailWorkPollThreadList`);

  await Promise.allSettled([
    _pollNewEmailThreads(), // get emails from inbox
    _pollNewEmailThreads("from:(me)"), // get emails sent by me
    _pollNewEmailThreads("in:drafts"), // messages that are in draft
  ]);

  logger.warn(`Done Polling`);
}

// this job is temporary, will be removed
export async function doDecodeBase64ForRawContent() {
  logger.warn(`doDecodeBase64ForRawContent`);

  const messagesFromDatabase = await Models.RawContent.findAll({
    // limit: 1
  });

  logger.warn(
    `doDecodeBase64ForRawContent : start decoding ${messagesFromDatabase.length}`
  );

  let processedSofar = 0;
  let messagesToDecode = [];

  if (messagesFromDatabase && messagesFromDatabase.length > 0) {
    for (let messageResponse of messagesFromDatabase) {
      processedSofar++;

      if (processedSofar % 500 === 0) {
        logger.info(
          `${processedSofar} / ${messagesFromDatabase.length} (${(
            (processedSofar / messagesFromDatabase.length) *
            100
          ).toFixed(1)}%)`
        );

        if (messagesToDecode.length > 0)
          logger.info(` > messageId: ${messagesToDecode[0].messageId}`);
      }

      const message = JSON.parse(messageResponse.dataValues.rawApiResponse);

      // // look for parts and parse it
      // const parts = flattenGmailPayloadParts(message.payload);
      // if (parts && parts.length > 0) {
      //   for (let part of parts) {
      //     if (part.body.data) {
      //       part.body.data = _parseGmailMessage(part.body.data);
      //     }
      //   }
      // }

      const newRawMessage = {
        ...messageResponse.dataValues,
        rawApiResponse: JSON.stringify(message),
        date: message.internalDate,
      };

      messagesToDecode.push(newRawMessage);

      if (messagesToDecode.length === 100) {
        await Models.RawContent.bulkCreate(messagesToDecode, {
          updateOnDuplicate: ["rawApiResponse", "date"],
        });
        messagesToDecode = [];
      }
    }
  }

  logger.warn(`doDecodeBase64ForRawContent : done decoding`);
}
