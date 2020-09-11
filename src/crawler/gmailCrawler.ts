// @ts-nocheck
import fs from "fs";
import { Base64 } from "js-base64";
import { JSDOM } from "jsdom";
import prettier from "prettier";
import truncate from "lodash/truncate";
import trim from "lodash/trim";
import startCase from "lodash/startCase";

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
  MIME_TYPE_ENUM,
  THREAD_JOB_STATUS_ENUM,
  GMAIL_ATTACHMENT_PATH,
  MAX_TIME_PER_THREAD,
  interestedEmails,
} from "./appConstantsEnums";

import * as CommonUtils from "./commonUtils";
import * as DataUtils from "./dataUtils";

// google crawler
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
        `Cannot fetch Raw Content threadId=${targetThreadId} error=${JSON.stringify(
          err.stack || err
        )}`
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
      const { id, threadId, labelIds, snippet, isChat, isEmail } = message;

      try {
        let rawBodyPlain = "";
        let rawBodyHtml = "";
        let rawBody = "";
        const parts = googleApiUtils.flattenGmailPayloadParts(message.payload);
        if (parts && parts.length > 0) {
          for (let part of parts) {
            let { mimeType, partId } = part;
            const { size, attachmentId, data } = part.body;
            const partHeaders = _getHeaders(part.headers || []);
            const fileName =
              part.filename || `parts.${threadId}.${id}.${partId || ""}`;
            const partHeaderContentId = partHeaders["content-id"];

            if (mimeType === MIME_TYPE_ENUM.APP_OCTLET_STREAM) {
              if (partHeaderContentId) {
                if (
                  partHeaderContentId.toLowerCase().includes("uniqueimageid")
                ) {
                  mimeType = MIME_TYPE_ENUM.IMAGE_JPEG;
                }
              } else {
                if (
                  fileName.includes(".java") ||
                  fileName.includes(".log") ||
                  fileName.includes(".c") ||
                  fileName.includes(".cpp") ||
                  fileName.includes(".cs") ||
                  false
                ) {
                  mimeType = MIME_TYPE_ENUM.TEXT_PLAIN;
                } else if (fileName.includes(".doc")) {
                  mimeType = MIME_TYPE_ENUM.APP_MS_DOC;
                } else if (fileName.includes(".docx")) {
                  mimeType = MIME_TYPE_ENUM.APP_MS_DOCX;
                } else if (fileName.includes(".csv")) {
                  mimeType = MIME_TYPE_ENUM.TEXT_CSV;
                } else if (fileName.includes(".xls")) {
                  mimeType = MIME_TYPE_ENUM.APP_MS_XLS;
                } else if (fileName.includes(".xlsx")) {
                  mimeType = MIME_TYPE_ENUM.APP_MS_XLSX;
                }
              }

              logger.debug(
                `Remapped Oclet Stream threadId=${threadId} id=${id} partId=${partId} mimeType=${mimeType} size=${size}`
              );
            }

            logger.debug(
              `Parsing Part of Message: threadId=${threadId} id=${id} partId=${partId} mimeType=${mimeType} size=${size}`
            );

            if (attachmentId) {
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
                      headers: JSON.stringify(partHeaders),
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
                `Parsing Message as Raw Content: threadId=${threadId} id=${id} partId=${partId} mimeType=${mimeType}`
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

                  const newFilePath = `${GMAIL_ATTACHMENT_PATH}/${fileName}`;

                  _saveBase64DataToFile(newFilePath, data);

                  attachmentsToSave.push({
                    id: fileName,
                    threadId,
                    messageId: id,
                    mimeType: mimeType,
                    fileName: fileName,
                    path: newFilePath,
                    headers: JSON.stringify(partHeaders),
                    size: fs.statSync(newFilePath).size,
                    inline: 1,
                  });
                  break;

                case MIME_TYPE_ENUM.TEXT_PLAIN:
                  logger.debug(
                    `Found rawBodyPlain for id=${id} partId=${partId} `
                  );
                  rawBodyPlain = data;
                  break;

                case MIME_TYPE_ENUM.TEXT_X_AMP_HTML:
                case MIME_TYPE_ENUM.TEXT_HTML:
                  rawBodyHtml = data;
                  logger.debug(
                    `Found rawBodyHtml for id=${id} partId=${partId} `
                  );
                  break;
              }
            }
          }
        }

        const headers: Headers = _getHeaders(message.payload.headers || []);

        const from = _parseEmailAddress(headers.from) || headers.from;

        const to = _parseEmailAddressList(headers.to);

        const bcc = _parseEmailAddressList(headers.bcc);

        let rawSubject;
        if (headers.subject) {
          rawSubject = startCase(headers.subject.toLowerCase());
        } else {
          rawSubject = `${from} ${id}`;
        }
        rawSubject = trim(rawSubject, " -_><:.()[]{}");

        // see if we need to handle further fetching from here
        // here we might face body of a url or subject of a url
        let subject = rawSubject;

        // stripped down body (remove signatures and clean up the dom)
        if (rawBodyPlain) {
          rawBody = tryParseBody(rawBodyPlain);
        } else {
          rawBody = tryParseBody(rawBodyHtml);
        }
        rawBody = (rawBody || snippet || "").trim();
        let strippedDownBody = rawBody;

        // trim the signatures
        for (let signature of mySignatureTokens) {
          strippedDownBody = strippedDownBody.replace(signature, "");
        }
        strippedDownBody = strippedDownBody.trim();

        let body = strippedDownBody;

        let urlToCrawl;

        if (isEmail) {
          if (CommonUtils.isStringUrl(subject)) {
            // if subject is a url
            urlToCrawl = CommonUtils.extractUrlFromString(subject);

            try {
              logger.debug(
                `Crawl subject with url: id=${id} url=${urlToCrawl}`
              );
              const websiteRes = await CommonUtils.crawlUrl(urlToCrawl);

              logger.debug(
                `Done CrawlUrl threadId=${threadId} id=${id} url=${urlToCrawl} res=${websiteRes.subject}`
              );

              subject = `${rawSubject} ${websiteRes.subject}`;
              body = `
                  <div>${rawBodyPlain}</div>
                  <div>================================</div>
                  <div>${websiteRes.subject}</div>
                  <div>${urlToCrawl}</div>
                `;
            } catch (err) {
              logger.debug(
                `Failed CrawlUrl for threadId=${threadId} id=${id} url=${urlToCrawl} err=${err}`
              );
              body = strippedDownBody;
            }
          } else if (CommonUtils.isStringUrl(body)) {
            // if body is a url
            urlToCrawl = CommonUtils.extractUrlFromString(
              _parseBodyWithHtml(body)
            );

            try {
              // crawl the URL for title
              logger.debug(`Crawl body with url: id=${id} url=${urlToCrawl}`);
              const websiteRes = await CommonUtils.crawlUrl(urlToCrawl);

              logger.debug(
                `Done CrawlUrl threadId=${threadId} id=${id} url=${urlToCrawl} res=${websiteRes.subject}`
              );

              subject = `${rawSubject} ${websiteRes.subject}`;
              body = `
                  <div>${rawBodyPlain}</div>
                  <div>================================</div>
                  <div>${websiteRes.subject}</div>
                  <div>${urlToCrawl}</div>
                `;
            } catch (err) {
              logger.debug(
                `Failed CrawlUrl for threadId=${threadId} id=${id} url=${urlToCrawl} err=${err}`
              );
              body = strippedDownBody;
            }
          }
        }

        body =
          tryParseBody(body || rawBodyPlain || rawBodyHtml || snippet) || "";
        rawBody = rawBodyHtml || rawBodyPlain || snippet || "";

        const messageToSave = {
          id,
          threadId,
          status: THREAD_JOB_STATUS_ENUM.PENDING_SYNC_TO_GDRIVE,
          body,
          rawBody,
          subject: truncate(subject, {
            length: 250,
          }),
          // rawSubject: truncate(rawSubject, {
          //   length: 250,
          // }),
          // from: from || null,
          // to: to.join(",") || null,
          // bcc: bcc.join(",") || null,
          // labelIds: (labelIds || []).join(",") || null,
          // rawApiResponse: JSON.stringify(message),
          // headers: JSON.stringify(headers),
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
          `Failed to process threadId=${targetThreadId} error=${JSON.stringify(
            err.stack || err
          )}`
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
    await DataUtils.bulkUpsertAttachments(attachmentsToSave).catch((err) => {
      logger.error(
        `Bulk create attachment failed, trying to do update instead threadId=${targetThreadId} error=${JSON.stringify(
          err.stack || err
        )}`
      );
    });

    logger.debug(`Done processing threadId=${targetThreadId}`);

    await DataUtils.bulkUpsertThreadJobStatuses({
      threadId: targetThreadId,
      processedDate: Math.round(Date.now() / 1000),
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
            `Cannot parse email address list: ${emailAddress} error=${JSON.stringify(
              err.stack || err
            )}`
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
      .replace(/[<>]/g, "")
      .toLowerCase()
      .trim();
  } catch (err) {
    logger.error(
      `Cannot parse email: ${emailAddress} error=${JSON.stringify(
        err.stack || err
      )}`
    );
    return null;
  }
}

async function _pollNewEmailThreads(q = "") {
  const startTime = Date.now();

  let countPageProcessed = 0;
  let pageToken = "";
  let threadIds = [];

  let countTotalPagesToCrawl = process.env.GMAIL_PAGES_TO_CRAWL || 1;

  logger.debug(
    `Crawl list of email threads: q=${q} maxPages=${countTotalPagesToCrawl} lastToken=${pageToken}`
  );

  let countThreadsSoFar = 0;
  const promises = [];

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
        promises.push(
          DataUtils.bulkUpsertThreadJobStatuses(
            threadIds.map(({ id, historyId, snippet }) => ({
              threadId: id,
              historyId,
              snippet,
              processedDate: null,
              duration: null,
              totalMessages: null,
              status: THREAD_JOB_STATUS_ENUM.PENDING_CRAWL,
            }))
          )
        );
      }

      countThreadsSoFar += threadIds.length;

      if (!nextPageToken) {
        logger.debug(
          `Stopped crawl due to q=${q} totalPages=${countPageProcessed}/${countTotalPagesToCrawl} nextPageToken=${nextPageToken}`
        );
        break;
      }

      if (countPageProcessed % 5 === 0 && countPageProcessed > 0) {
        logger.debug(
          `So far crawled q=${q} totalPages=${countPageProcessed}/${countTotalPagesToCrawl} totalThreads=${countThreadsSoFar}`
        );
      }
    } catch (err) {
      logger.error(
        `Failed to get thread list q=${q} totalPages=${countPageProcessed}/${countTotalPagesToCrawl} pageToken=${pageToken} error=${JSON.stringify(
          err.stack || err
        )}`
      );
      break;
    }
  }

  await Promise.all(promises);

  logger.debug(
    `Done Crawl list of email threads q=${q} totalPages=${countPageProcessed}/${countTotalPagesToCrawl} totalThreads=${countThreadsSoFar}  duration=${
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
    .replace(/<\/[ ]*div>/gi, "</div><br />")
    .replace(/<\/[ ]*section>/gi, "</section><br />")
    .replace(/<\/[ ]*header>/gi, "</header><br />")
    .replace(/<br[ /]*>/gi, "\n")
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
export function parseGmailMessage(bodyData) {
  return Base64.decode((bodyData || "").replace(/-/g, "+").replace(/_/g, "/"))
    .trim()
    .replace(/[\r\n]/g, "\n");
}

export function _parseBodyWithText(html) {
  let body = html || "";
  try {
    return body.trim();
  } catch (e) {
    return body;
  }
}

export function _parseBodyWithHtml(html) {
  try {
    const dom = new JSDOM(_cleanHtml(html));

    // replace anchors href with links
    const anchors = dom.window.document.querySelectorAll("a");
    for (const anchor of anchors) {
      const url = anchor.getAttribute("href");
      if (url && url.includes("http")) {
        anchor.innerText = url;
      }
    }

    // replace all the script tags
    const scripts = dom.window.document.querySelectorAll("script");
    for (const script of scripts) {
      script.remove();
    }

    // clean up all the whitespaces
    // const blocks = dom.window.document.querySelectorAll(
    //   "div,p,section,span,header,footer"
    // );
    // for (const block of blocks) {
    //   block.textContent = block.textContent
    //     .replace("\r", "\n")
    //     .split("\n")
    //     .join(" ");
    // }

    const textContent = trim(dom.window.document.body.textContent);

    if (
      (textContent.includes("// ") ||
        textContent.includes("/* ") ||
        textContent.includes("var ") ||
        textContent.includes("const ")) &&
      textContent.includes("function ")
    ) {
      // if this is js snippet, just return it
      try {
        return prettier.format(textContent, { parser: "babel" });
      } catch (err) {
        return textContent;
      }
    }

    return textContent;
  } catch (err) {
    logger.debug(
      `_parseBodyWithHtml failed error=${JSON.stringify(err.stack || err)}`
    );
  }
}

export function tryParseBody(rawBody) {
  rawBody = (rawBody || "").trim();
  return (
    _parseBodyWithHtml(rawBody) ||
    _parseBodyWithText(rawBody) ||
    rawBody ||
    ""
  )
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => !!r)
    .join("\n")
    .replace(/[-][-][-][-][-]*/gi, "================================\n")
    .replace(/[\*][\*][\*][\*][\*]*/gi, "================================\n");
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
    logger.debug(`Skipped Downloading attachment path=${newFilePath}`);
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
  let totalMessages = 0;

  for (let threadId of threadIds) {
    try {
      let threadMessages = await DataUtils.getRawContentsByThreadId(threadId);

      if (process.env.FORCE_REFETCH_THREADS !== "true") {
        if (threadMessages && threadMessages.length > 0) {
          logger.debug(
            `Skipped Fetching raw content for threadId=${threadId} forcedRefetch=true`
          );
          continue;
        }
      }

      // if not found from db, then fetch its raw content
      logger.debug(
        `Start Fetching raw content for threadId=${threadId} forcedRefetch=true`
      );

      const { messages } = await googleApiUtils.getEmailContentByThreadId(
        threadId
      );

      totalMessages += messages.length;

      // TODO:
      // get emails from the google drafts api

      // parse the content and insert raw content
      const promisesSaveParentFolders = [];
      const promisesSaveMessages = messages.map((message) => {
        const { id, threadId } = message;

        const parts = googleApiUtils.flattenGmailPayloadParts(message.payload);
        if (parts && parts.length > 0) {
          for (let part of parts) {
            if (part.body.data) {
              part.body.data = parseGmailMessage(part.body.data);
            }
          }
        }

        const headers: Headers = _getHeaders(message.payload.headers || []);
        const from = headers.from.includes("profiles.google.com")
          ? headers.from.substr(0, headers.from.indexOf("<")).trim()
          : _parseEmailAddress(headers.from) || headers.from;

        let to;
        to = _parseEmailAddressList(headers.to);
        if(to.length === 0){
          to = _parseEmailAddressList(headers["delivered-to"]);
        }

        const bcc = _parseEmailAddressList(headers.bcc);
        const rawSubject = (headers.subject || `${from} ${id}`).trim();

        let isChat = false;
        let isEmail = true;
        const labelIds = message.labelIds || [];
        if (labelIds.some((labelId) => labelId.includes("CHAT"))) {
          isChat = true;
          isEmail = false;
        }

        const starred = labelIds.some((labelId) => labelId.includes("STARRED"));

        const isEmailSentByMe = interestedEmails.some(
          (myEmail) => from.toLowerCase() === myEmail.toLowerCase()
        );

        const emailMessageToSave = {
          id: id,
          threadId: threadId,
          labelIds: labelIds.join(","),
          rawSubject: truncate(rawSubject, {
            length: 250,
          }),
          from,
          to: to.join(",") || null,
          bcc: bcc.join(",") || null,
          rawApiResponse: JSON.stringify({
            ...message,
            isChat,
            isEmail,
            isEmailSentByMe,
          }),
          date: Math.round((message.internalDate || Date.now()) / 1000),
          status: THREAD_JOB_STATUS_ENUM.PENDING_PARSE_EMAIL,
          isChat,
          isEmail,
          isEmailSentByMe,
          starred,
        };

        // generate the record for folder id for future use
        const parentFolderName = CommonUtils.generateFolderName(from);
        promisesSaveParentFolders.push(
          DataUtils.bulkUpsertFolders({
            folderName: parentFolderName,
          })
        );

        logger.debug(
          `Saving raw content for threadId=${threadId} subject=${rawSubject}`
        );

        return DataUtils.bulkUpsertEmails(emailMessageToSave).catch((err) => {
          logger.error(
            `Insert raw content failed threadId=${threadId} id=${id} error=${JSON.stringify(
              err.stack || err
            )}`
          );
          throw err;
        });
      });

      await Promise.all(promisesSaveMessages);
      await Promise.allSettled(promisesSaveParentFolders);

      // move on to next stage
      await DataUtils.bulkUpsertThreadJobStatuses({
        threadId: threadId,
        status: THREAD_JOB_STATUS_ENUM.PENDING_PARSE_EMAIL,
      });
    } catch (err) {
      logger.error(
        `Fetch raw content failed threadId=${threadId} error=${JSON.stringify(
          err.stack || err
        )}`
      );
      await DataUtils.bulkUpsertThreadJobStatuses({
        threadId: threadId,
        status: THREAD_JOB_STATUS_ENUM.ERROR_CRAWL,
      });
    }
  }

  logger.debug(`DONE fetchRawContentsByThreadId firstThreadId=${threadIds[0]}`);

  return totalMessages;
}

/**
 * This is simply to get a list of all email threadIds
 */
export async function pollForNewThreadList(afterThisDate = "") {
  logger.debug(`pollForNewThreadList after=${afterThisDate}`);
  if (afterThisDate) {
    afterThisDate = `after:${afterThisDate}`;
  }
  _pollNewEmailThreads(`from:(me) ${afterThisDate}`); // get emails sent by me
  _pollNewEmailThreads(`in:drafts ${afterThisDate}`); // messages that are in draft
  _pollNewEmailThreads(`${afterThisDate}`); // get emails from inbox
}
