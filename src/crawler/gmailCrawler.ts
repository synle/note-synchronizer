// @ts-nocheck
const { Readability } = require("@mozilla/readability");
const { Base64 } = require("js-base64");
import axios from "axios";
const fs = require("fs");
const { JSDOM } = require("jsdom");
const readline = require("readline");
const { google } = require("googleapis");
const moment = require("moment");

import {
  Email,
  Headers,
  DatabaseResponse,
  GmailAttachmentResponse,
} from "../types";
import Models from "../models/modelsSchema";

import { logger } from "../loggers";

let gmail;
let drive;

const useInMemoryCache = true;

const mySignatureTokens = (process.env.MY_SIGNATURE_TOKEN || "").split("|||");

enum MimeTypeEnum {
  APP_JSON = "application/json",
  APP_GOOGLE_DOCUMENT = "application/vnd.google-apps.document",
  APP_GOOGLE_FOLDER = "application/vnd.google-apps.folder",
  APP_GOOGLE_PRESENTATION = "application/vnd.google-apps.presentation",
  APP_GOOGLE_SPREADSHEET = "application/vnd.google-apps.spreadsheet",
  APP_MS_XLS = "application/vnd.ms-excel",
  APP_MS_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // TODO: confirm
  APP_MS_PPT = "application/vnd.ms-powerpoint",
  APP_MS_PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  APP_MS_DOC = "application/msword", // TODO: confirm
  APP_MS_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  APP_XML = "application/xml",
  IMAGE_GIF = "image/gif",
  IMAGE_JPEG = "image/jpeg",
  IMAGE_JPG = "image/jpg",
  IMAGE_PNG = "image/png",
  MULTIPART_ALTERNATIVE = "multipart/alternative",
  MULTIPART_RELATED = "multipart/related",
  TEXT_HTML = "text/html",
  TEXT_PLAIN = "text/plain",
  TEXT_PLAIN = "text/plain",
  TEXT_X_AMP_HTML = "text/x-amp-html",
  TEXT_XML = "text/xml",
  TEXT_CSV = "text/csv",
}

// google crawler
// If modifying these scopes, delete token.json.
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"].concat([
  "https://www.googleapis.com/auth/drive",
]);
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const GMAIL_TOKEN_PATH = "token.json";
const GMAIL_CREDENTIALS_PATH = "credentials.json";
const GMAIL_ATTACHMENT_PATH = "./attachments";

const GMAIL_PATH_THREAD_LIST = `./caches/gmail.threads.data`;
const GMAIL_PATH_THREAD_LIST_TOKEN = `./caches/gmail.threads_last_tokens.data`;

// core apis
/**
 * Lists the labels in the user's account.
 */
function _listLabels() {
  return new Promise((resolve, reject) => {
    gmail.users.labels.list(
      {
        userId: "me",
      },
      (err, res) => {
        if (err) {
          logger.error(`API Failed ${JSON.stringify(err)}`);
          return reject(err.response.data);
        }
        resolve(res.data.labels);
      }
    );
  });
}

/**
 * api to get the list of threads
 * @param pageToken
 */
function _getThreads(pageToken) {
  return new Promise((resolve, reject) => {
    gmail.users.threads.list(
      {
        userId: "me",
        pageToken,
      },
      (err, res) => {
        if (err) {
          logger.error(`API Failed ${JSON.stringify(err)}`);
          return reject(err.response.data);
        }
        resolve(res.data);
      }
    );
  });
}

/**
 * get a list of emails by threads
 * @param targetThreadId
 */
function _getThreadEmails(targetThreadId) {
  return new Promise((resolve, reject) => {
    gmail.users.threads.get(
      {
        userId: "me",
        id: targetThreadId,
      },
      (err, res) => {
        if (err) {
          logger.error(`API Failed ${JSON.stringify(err)}`);
          return reject(err.response.data);
        }
        resolve(res.data);
      }
    );
  });
}

function _getAttachment(messageId, attachmentId) {
  return new Promise((resolve, rejects) => {
    gmail.users.messages.attachments
      .get({
        id: attachmentId,
        messageId,
        userId: "me",
      })
      .then((res, err) => {
        if (err) {
          logger.error(`API Failed ${JSON.stringify(err)}`);
          return reject(err.response.data);
        }
        resolve(res.data.data);
      });
  });
}

function _createFileInDrive(resource, media) {
  return new Promise((resolve, reject) => {
    drive.files.create(
      {
        resource,
        media,
        fields: "id",
      },
      function (err, res) {
        if (err) {
          logger.error(`API Failed ${JSON.stringify(err)}`);
          return reject(err.response.data);
        }
        resolve(res.data);
      }
    );
  });
}

function _updateFileInDrive(fileId, resource, media) {
  return new Promise((resolve, reject) => {
    drive.files.update(
      {
        fileId,
        media,
        fields: "id",
      },
      function (err, res) {
        if (err) {
          logger.error(`API Failed ${JSON.stringify(err)}`);
          return reject(err.response.data);
        }
        resolve(res.data);
      }
    );
  });
}

function _createFolderInDrive(resource) {
  return new Promise((resolve, reject) => {
    drive.files.create(
      {
        resource,
        fields: "id",
      },
      function (err, res) {
        if (err) {
          logger.error(`API Failed ${JSON.stringify(err)}`);
          return reject(err.response.data);
        }
        resolve(res.data);
      }
    );
  });
}

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
      logger.debug(`Error crawlUrl: ${url} ${JSON.stringify(response)}`);
      return;
    }
    const rawHtmlBody = response.data;

    return {
      subject: parseHtmlTitle(rawHtmlBody) || "",
      body: rawHtmlBody,
    };
  } catch (e) {
    logger.debug(`Error crawlUrl: ${url} ${e}`);
  }
}

function _sanatizeGoogleQuery(string) {
  return (string || "").replace(/'/g, "\\'");
}

function _searchGoogleDrive(name, mimeType, parentFolderId) {
  const queries = [];

  queries.push(`trashed=false`);

  queries.push(`name='${_sanatizeGoogleQuery(name)}'`);

  if (parentFolderId) {
    queries.push(`parents in '${_sanatizeGoogleQuery(parentFolderId)}'`);
  }

  if (mimeType) {
    queries.push(`mimeType='${_sanatizeGoogleQuery(mimeType)}'`);
  }

  const q = queries.join(" AND ");

  return new Promise((resolve, reject) => {
    drive.files.list(
      {
        q,
        fields: "nextPageToken, files(id, name)",
        spaces: "drive",
        // pageToken: pageToken,
      },
      function (err, res) {
        if (err) {
          return reject({
            ...err.response.data,
            q,
          });
        }
        resolve(res.data.files);
      }
    );
  });
}

// crawler start

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function _authorize(credentials, callback) {
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  // Check if we have previously stored a token.
  fs.readFile(GMAIL_TOKEN_PATH, (err, token) => {
    if (err) return _getNewToken(oAuth2Client, callback);
    oAuth2Client.setCredentials(JSON.parse(token));
    callback(oAuth2Client);
  });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function _getNewToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });
  logger.info("Authorize this app by visiting this url:", authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question("Enter the code from that page here: ", (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return logger.error("Error retrieving access token", err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(GMAIL_TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return logger.error(err);
        logger.info("Token stored to", GMAIL_TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}

function _flattenGmailPayloadParts(initialParts) {
  const res = [];

  let stack = [initialParts];

  while (stack.length > 0) {
    const target = stack.pop();
    const { parts, ...rest } = target;
    res.push(rest);

    if (parts && parts.length > 0) {
      stack = [...stack, ...parts];
    }
  }

  return res;
}

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
        const { messages } = await _getThreadEmails(targetThreadId);

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
            `Insert raw content failed threadId=${threadId} id=${id} ${err}`
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
        const parts = _flattenGmailPayloadParts(message.payload);
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

        if (_isStringUrl(subject)) {
          // if subject is a url
          const urlToCrawl = _extractUrlFromString(subject);

          // crawl the URL for title
          logger.debug(`Crawling subject with url: id=${id} ${urlToCrawl}`);
          const websiteRes = await _crawlUrl(urlToCrawl);

          if (websiteRes && websiteRes.subject) {
            subject = (websiteRes.subject || "").trim();
            body = `<a href='${urlToCrawl}'>${urlToCrawl}</a><hr />${websiteRes.body}`.trim();
          } else {
            logger.debug(`Crawl failed for id=${id} url${urlToCrawl}`);
            body = `<a href='${urlToCrawl}'>${urlToCrawl}</a><hr /><h2>404_Page_Not_Found</h2>`.trim();
          }
        } else if (body.length < 255 && _isStringUrl(body)) {
          // if body is a url
          const urlToCrawl = _extractUrlFromString(body);
          if (urlToCrawl) {
            // crawl the URL for title
            logger.debug(`Crawling body with url: id=${id} ${urlToCrawl}`);
            const websiteRes = await _crawlUrl(urlToCrawl);
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
            `Inserting email failed, trying updating threadId=${threadId} id=${id} ${err}`
          );
          return Models.Email.update(messageToUse, {
            where: {
              id: messageToUse.id,
            },
          }).catch((err) => {
            logger.error(
              `Upsert email failed threadId=${threadId} id=${id} ${err}`
            );
          });
        });
      } catch (err) {
        logger.error(
          `Failed to process threadId=${threadId} id=${id}   error=${err}`
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
          `Insert attachment failed, trying to do update instead threadId=${attachment.threadId} id=${attachment.messageId} attachmentId=${attachment.id} ${err}`
        );
        return Models.Attachment.update(attachment, {
          where: {
            id: attachment.id,
          },
        }).catch((err) => {
          logger.error(
            `Upsert email attachment failed threadId=${attachment.threadId} id=${attachment.messageId} attachmentId=${attachment.id} ${err}`
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

async function _pollNewEmailThreads() {
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
      const { threads, nextPageToken } = await _getThreads(pageToken);
      allThreads = [...allThreads, ...(threads || []).map((r) => r.id)];
      pageToken = nextPageToken;

      if (!nextPageToken) {
        break;
      }

      fs.appendFileSync(GMAIL_PATH_THREAD_LIST_TOKEN, nextPageToken + "\n");

      if (countPageProcessed % 25 === 0 && countPageProcessed > 0) {
        logger.info(`${countPageProcessed} pages crawled so far`);
      }
    } catch (e) {
      logger.error(
        `Failed to get thread list pageToken=${pageToken}  error=${e}`
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
    const attachmentResponse = await _getAttachment(
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

  const matchedResults = await _searchGoogleDrive(
    fileGDriveMetadata.name,
    fileGDriveMetadata.mimeType,
    parentFolderId
  );
  if (matchedResults.length === 0) {
    logger.debug("Upload file with create operation", name);
    return _createFileInDrive(fileGDriveMetadata, media);
  } else {
    logger.debug(
      "Upload file with update operation",
      name,
      matchedResults[0].id
    );
    return _updateFileInDrive(matchedResults[0].id, fileGDriveMetadata, media);
  }
}

export async function createDriveFolder(name, description, parentFolderId) {
  const mimeType = MimeTypeEnum.APP_GOOGLE_FOLDER;

  const matchedResults = await _searchGoogleDrive(name, mimeType);
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
    return (await _createFolderInDrive(fileGDriveMetadata)).id;
  } else {
    return matchedResults[0].id;
  }
}

/**
 * api used to init to be called to get the gmail api setup
 * @param onAfterInitFunc
 */
export const initGoogleApi = (onAfterInitFunc = () => {}) => {
  return new Promise((resolve, reject) => {
    // Load client secrets from a local file.
    fs.readFile(GMAIL_CREDENTIALS_PATH, (err, content) => {
      if (err) return reject("Error loading client secret file:" + err);
      // Authorize a client with credentials, then call the Gmail API.
      _authorize(JSON.parse(content), function (auth) {
        gmail = google.gmail({ version: "v1", auth });
        drive = google.drive({ version: "v3", auth });

        onAfterInitFunc(gmail, drive);
        resolve();
      });
    });
  });
};

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
  return _pollNewEmailThreads();
}
