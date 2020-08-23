// @ts-nocheck
import fs from "fs";
import { Readability } from "@mozilla/readability";
import { Base64 } from "js-base64";
import { JSDOM } from "jsdom";
import prettier from "prettier";

import {
  Email,
  Headers,
  GmailAttachmentResponse,
  GmailMessageResponse,
} from "../types";

import { logger } from "../loggers";
import * as googleApiUtils from "./googleApiUtils";

import {
  mySignatureTokens,
  isStringUrl,
  extractUrlFromString,
  crawlUrl,
  maxThreadCount,
  MIME_TYPE_ENUM,
  THREAD_JOB_STATUS_ENUM,
} from "./commonUtils";

import * as DataUtils from "./dataUtils";
import { allColors } from "winston/lib/winston/config";

// google crawler
const GMAIL_ATTACHMENT_PATH = "./attachments";
const GMAIL_PATH_THREAD_LIST_TOKEN = `./caches/gmail.threads_last_tokens.data`;

const MAX_TIME_PER_THREAD = 20 * 60 * 1000; // spend up to this many mins per thread
// crawler start

/**
 * api to get and process the list of message by a thread id
 * @param targetThreadId
 */
export function processMessagesByThreadId(targetThreadId): Promise<Email[]> {
  return new Promise(async (resolve, reject) => {
    const attachmentDownloadsPromises = []; // promises to keep track of attachment async download
    const attachmentsToSave = [];
    const startTime = Date.now();
    let ignoreTimerForTimeout = false;

    // take ownership of the task
    await DataUtils.bulkUpsertThreadJobStatuses({
      threadId: targetThreadId,
      status: THREAD_JOB_STATUS_ENUM.IN_PROGRESS,
    });

    setTimeout(async () => {
      if (ignoreTimerForTimeout !== false) {
        return;
      }

      logger.error(
        `Aborted working on thread due to Timeout issues: threadId=${targetThreadId} totalMessages=${threadMessages.length}`
      );

      // update the process time and status to error timeout
      await DataUtils.bulkUpsertThreadJobStatuses({
        threadId: targetThreadId,
        processedDate: null,
        duration: Math.round((Date.now() - startTime) / 1000),
        totalMessages: threadMessages.length,
        status: THREAD_JOB_STATUS_ENUM.ERROR_TIMEOUT,
      });

      reject("Timeout for task");
    }, MAX_TIME_PER_THREAD);

    let threadMessages: GmailMessageResponse[] = [];
    let foundRawEmailsFromDbOrCache = false;

    logger.debug(`Start working on thread: threadId=${targetThreadId}`);

    try {
      // attempting at getting the emails from rawcontent in the database
      if (threadMessages.length === 0) {
        const messagesFromDatabase: GmailMessageResponse[] = await DataUtils.getRawContentsByThreadId(
          targetThreadId
        );

        logger.debug(
          `Raw Content Result from DB threadId=${targetThreadId}: ${messagesFromDatabase.length}`
        );

        if (messagesFromDatabase && messagesFromDatabase.length > 0) {
          threadMessages = messagesFromDatabase;
          foundRawEmailsFromDbOrCache = true;
        }
      }
    } catch (err) {
      logger.error(
        `Cannot fetch Raw Content threadId=${targetThreadId} : ${
          err.stack || err
        }`
      );
    }

    if (threadMessages.length === 0) {
      logger.error(
        `Aborted working on thread No messages found with this threadId: threadId=${targetThreadId}`
      );

      ignoreTimerForTimeout = true; // clear the timeout timer

      await DataUtils.bulkUpsertThreadJobStatuses({
        threadId: targetThreadId,
        processedDate: null,
        duration: Math.round((Date.now() - startTime) / 1000),
        totalMessages: threadMessages.length,
        status: THREAD_JOB_STATUS_ENUM.ERROR_THREAD_NOT_FOUND,
      });

      return resolve(threadMessages.length);
    }

    logger.debug(
      `Found and start processing threadId=${targetThreadId} totalMessages=${threadMessages.length}`
    );

    // start processing
    for (let message of threadMessages) {
      const { id, threadId, labelIds } = message;
      const messageDate = message.internalDate;

      try {
        let rawBody = "";
        const parts = googleApiUtils.flattenGmailPayloadParts(message.payload);
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
                      size: fs.statSync(attachmentPath).size,
                      inline: 0,
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
                    fileName || `parts.${threadId}.${id}.${partId || ""}`;

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
                    size: fs.statSync(newFilePath).size,
                    inline: 1,
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
        let strippedDownBody = tryParseBody(rawBody); // attempt at using one of the parser;

        // trim the signatures
        for (let signature of mySignatureTokens) {
          strippedDownBody = strippedDownBody.replace(signature, "");
        }
        strippedDownBody = strippedDownBody.trim();

        let body = strippedDownBody;

        if (isStringUrl(subject)) {
          // if subject is a url
          const urlToCrawl = extractUrlFromString(subject);

          try {
            logger.debug(`Crawl subject with url: id=${id} url=${urlToCrawl}`);
            const websiteRes = await crawlUrl(urlToCrawl);

            logger.debug(
              `Done CrawlUrl threadId=${threadId} id=${id} url=${urlToCrawl} res=${websiteRes.subject}`
            );

            subject = (websiteRes.subject || "").trim();
            body = tryParseBody(`
              ${body}
                <br /><br />

                <a href='${urlToCrawl}'>${urlToCrawl}</a>
                <br /><br />

                ${websiteRes.body}
            `);
          } catch (err) {
            logger.debug(
              `Failed CrawlUrl for threadId=${threadId} id=${id} url=${urlToCrawl} err=${err}`
            );
            body = strippedDownBody;
          }
        } else if (isStringUrl(body)) {
          // if body is a url
          const urlToCrawl = extractUrlFromString(_parseBodyWithHtml(body));

          try {
            // crawl the URL for title
            logger.debug(`Crawl body with url: id=${id} url=${urlToCrawl}`);
            const websiteRes = await crawlUrl(urlToCrawl);

            logger.debug(
              `Done CrawlUrl threadId=${threadId} id=${id} url=${urlToCrawl} res=${websiteRes.subject}`
            );

            subject = `${subject} - ${websiteRes.subject || ""}`.trim();
            body = tryParseBody(`
              ${body}
              <br /><br />


              <a href='${urlToCrawl}'>${urlToCrawl}</a>
              <br /><br />


              ${websiteRes.body}
            `);
          } catch (err) {
            logger.debug(
              `Failed CrawlUrl for threadId=${threadId} id=${id} url=${urlToCrawl} err=${err}`
            );
            body = strippedDownBody;
          }
        }

        const fallbackSubject = `${from} ${id}`;

        const messageToSave = {
          id,
          threadId,
          status: THREAD_JOB_STATUS_ENUM.PENDING_SYNC_TO_GDRIVE,
          from: from || null,
          body: body || null,
          rawBody: rawBody || null,
          subject: subject || fallbackSubject,
          rawSubject: rawSubject || null,
          headers: JSON.stringify(headers),
          to: to.join(",") || null,
          bcc: bcc.join(",") || null,
          date,
          labelIds: (labelIds || []).join(",") || null,
          rawApiResponse: JSON.stringify(message),
        };

        logger.debug(
          `Pushing message to buffer: threadId=${threadId} id=${id} subject=${subject}`
        );

        // save messages
        logger.debug(
          `Saving message: threadId=${targetThreadId} id=${messageToSave.id}`
        );
        // await
        await DataUtils.bulkUpsertEmails(messageToSave);
      } catch (err) {
        logger.error(
          `Failed to process threadId=${targetThreadId} error=${
            err.stack || JSON.stringify(err)
          }`
        );
        await DataUtils.bulkUpsertThreadJobStatuses({
          threadId: threadId,
          status: THREAD_JOB_STATUS_ENUM.ERROR_CRAWL,
        });

        await DataUtils.bulkUpsertEmails({
          id,
          threadId,
          status: THREAD_JOB_STATUS_ENUM.ERROR_CRAWL,
        });
        break;
      }
    }

    // save attachments
    await Promise.all(attachmentDownloadsPromises); // waiting for attachment to download

    ignoreTimerForTimeout = true; // clear the timeout timer

    logger.debug(
      `Saving attachments: threadId=${targetThreadId} totalAttachments=${attachmentsToSave.length} totalDownloadJobs=${attachmentDownloadsPromises.length}`
    );

    // no need to wait for this attachments
    DataUtils.bulkUpsertAttachments(attachmentsToSave).catch((err) => {
      logger.error(
        `Bulk create attachment failed, trying to do update instead threadId=${targetThreadId} ${
          err.stack || JSON.stringify(err)
        }`
      );
    });

    logger.debug(`Done processing threadId=${targetThreadId}`);

    await DataUtils.bulkUpsertThreadJobStatuses({
      threadId: targetThreadId,
      processedDate: Date.now(),
      duration: Math.round((Date.now() - startTime) / 1000),
      totalMessages: threadMessages.length,
      status: THREAD_JOB_STATUS_ENUM.SUCCESS,
    });

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
        } catch (err) {
          logger.error(
            `Cannot parse email address list: ${emailAddress} : ${
              err.stack || err
            }`
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
  } catch (err) {
    logger.error(`Cannot parse email: ${emailAddress} ${err.stack || err}`);
    return null;
  }
}

async function _pollNewEmailThreads(doFullLoad, q = "") {
  const startTime = Date.now();

  let countPageProcessed = 0;
  let pageToken = "";
  let threadIds = [];

  if (doFullLoad !== true) {
    try {
      pageToken = fs
        .readFileSync(GMAIL_PATH_THREAD_LIST_TOKEN, "UTF-8")
        .split("\n")
        .map((r) => r.trim())
        .filter((r) => !!r);
      pageToken = pageToken[pageToken.length - 1] || "";
    } catch (e) {}
  }

  let countTotalPagesToCrawl = process.env.GMAIL_PAGES_TO_CRAWL || 1;

  logger.debug(
    `Crawl list of email threads: q=${q} maxPages=${countTotalPagesToCrawl} lastToken=${pageToken}`
  );

  let countThreadsSoFar = 0;

  while (countPageProcessed < countTotalPagesToCrawl) {
    countPageProcessed++;

    try {
      const { threads, nextPageToken } = await googleApiUtils.getThreadsByQuery(
        q,
        pageToken
      );
      threadIds = [...(threads || [])];
      pageToken = nextPageToken;

      if (threadIds.length > 0) {
        await DataUtils.bulkUpsertThreadJobStatuses(
          threadIds.map(({ id, historyId, snippet }) => ({
            threadId: id,
            historyId,
            snippet,
            processedDate: null,
            duration: null,
            totalMessages: null,
            status: THREAD_JOB_STATUS_ENUM.PENDING_CRAWL,
          }))
        );
      }

      countThreadsSoFar += threadIds.length;

      if (!nextPageToken) {
        break;
      }

      fs.appendFileSync(GMAIL_PATH_THREAD_LIST_TOKEN, nextPageToken + "\n");

      if (countPageProcessed % 25 === 0 && countPageProcessed > 0) {
        logger.debug(
          `So far, ${countPageProcessed} pages crawled  q=${q}: ${countThreadsSoFar} threads found`
        );
      }
    } catch (err) {
      logger.error(
        `Failed to get thread list q=${q} pageToken=${pageToken} error=${err.stack}`
      );
      break;
    }
  }

  logger.debug(`${countPageProcessed} total pages crawled:  q=${q}`);

  logger.debug(
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
  return string
    .replace(
      /<style( type="[a-zA-Z/+]+")?>[a-zA-Z0-9-_!*{:;}#.%,[^=\]@() \n\t\r"'/ŤŮ>?&~+µ]+<\/style>/gi,
      ""
    )
    .replace(/style=["'][\w\s#-:;@()!%"']+["']/gi, "");
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
function _parseGmailMessage(bodyData) {
  return Base64.decode((bodyData || "").replace(/-/g, "+").replace(/_/g, "/"))
    .trim()
    .replace(/[\r\n]/g, "\n");
}

function _parseBodyWithText(html) {
  let body = html || "";
  try {
    const dom = new JSDOM(_cleanHtml(html));
    body = dom.window.document.body.textContent;
  } catch (e) {}

  try {
    return body
      .replace("\r", "\n")
      .split(/[ ]/)
      .filter((r) => !!r)
      .join(" ")
      .split("\n")
      .filter((r) => !!r)
      .join("\n")
      .trim();
  } catch (e) {
    return body;
  }
}

export function _parseBodyWithHtml(html) {
  try {
    const dom = new JSDOM(_cleanHtml(html));
    return new JSDOM(
      new Readability(dom.window.document).parse().content
    ).window.document.body.textContent
      .replace("  ", "\n")
      .trim();
  } catch (err) {
    logger.debug(`_parseBodyWithHtml failed err=${err.stack}`);
  }
}

export function tryParseBody(rawBody) {
  rawBody = (rawBody || "").trim();
  return (
    _parseBodyWithHtml(rawBody) || _parseBodyWithText(rawBody) || rawBody || ""
  );
}

export function parsePageTitle(html) {
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
    const attachmentResponse = await googleApiUtils.getEmailAttachment(
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

export async function fetchRawContentsByThreadId(threadIds) {
  threadIds = [].concat(threadIds || []);

  logger.debug(`fetchRawContentsByThreadId firstThreadId=${threadIds[0]}`);

  for (let threadId of threadIds) {
    try {
      let threadMessages = await DataUtils.getRawContentsByThreadId(threadId);

      // if not found from db, then fetch its raw content
      if (!threadMessages || threadMessages.length === 0) {
        logger.debug(
          `fetch Gmail API to get raw content for threadId=${threadId}`
        );

        const { messages } = await googleApiUtils.getEmailContentByThreadId(
          threadId
        );

        // TODO:
        // get emails from the google drafts api

        // parse the content and insert raw content
        const promiseQueue = messages.map((message) => {
          const { id, threadId } = message;

          const parts = googleApiUtils.flattenGmailPayloadParts(
            message.payload
          );
          if (parts && parts.length > 0) {
            for (let part of parts) {
              if (part.body.data) {
                part.body.data = _parseGmailMessage(part.body.data);
              }
            }
          }

          const emailMessageToSave = {
            id: id,
            threadId: threadId,
            rawApiResponse: JSON.stringify(message),
            date: message.internalDate || Date.now(),
            status: THREAD_JOB_STATUS_ENUM.PENDING_PARSE_EMAIL,
          };

          return DataUtils.bulkUpsertEmails(emailMessageToSave).catch((err) => {
            logger.error(
              `Insert raw content failed threadId=${threadId} ${
                err.stack || JSON.stringify(err)
              } id=${id}`
            );
            throw err;
          });
        });

        await Promise.all(promiseQueue);
      } else {
        logger.debug(`Found raw content from cache for threadId=${threadId}`);
      }

      // move on to next stage
      await DataUtils.bulkUpsertThreadJobStatuses({
        threadId: threadId,
        status: THREAD_JOB_STATUS_ENUM.PENDING_PARSE_EMAIL,
      });
    } catch (err) {
      logger.error(`Fetch raw content failed threadId=${threadId} ${err}`);
      await DataUtils.bulkUpsertThreadJobStatuses({
        threadId: threadId,
        status: THREAD_JOB_STATUS_ENUM.ERROR_CRAWL,
      });
    }
  }

  logger.debug(`DONE fetchRawContentsByThreadId firstThreadId=${threadIds[0]}`);
}

/**
 * This is simply to get a list of all email threadIds
 */
export async function pollForNewThreadList(doFullLoad = true) {
  _pollNewEmailThreads(doFullLoad, "from:(me)"); // get emails sent by me
  _pollNewEmailThreads(doFullLoad, "in:drafts"); // messages that are in draft
  _pollNewEmailThreads(doFullLoad); // get emails from inbox
}
