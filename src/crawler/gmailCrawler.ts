// @ts-nocheck
const { Readability } = require("@mozilla/readability");
const { Base64 } = require("js-base64");
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

enum MimeTypeEnum {
  APP_JSON = "application/json",
  APP_GOOGLE_DOCUMENT = "application/vnd.google-apps.document",
  APP_GOOGLE_FOLDER = "application/vnd.google-apps.folder",
  APP_GOOGLE_PRESENTATION = "application/vnd.google-apps.presentation",
  APP_GOOGLE_SPREADSHEET = "application/vnd.google-apps.spreadsheet",
  APP_MS_XLS = "application/vnd.ms-excel",
  APP_MS_PPT = "application/vnd.ms-powerpoint",
  APP_MS_PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  APP_MS_WORD_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
          return reject(err.response.data);
        }
        resolve(res.data);
      }
    );
  });
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
export function _processMessagesByThreadId(targetThreadId): Promise<Email[]> {
  return new Promise(async (resolve, reject) => {
    // get from gmail api
    const messagesToReturn: Email[] = [];
    const attachments = [];

    let threadMessages;
    let foundFromDb = false;

    logger.debug(`> Working on thread: ${targetThreadId}`);

    // attempting at getting the emails from the database
    try {
      const messagesFromDatabase = await Models.RawContent.findAll({
        where: {
          threadId: targetThreadId,
        },
      });

      logger.debug(`> Threads Result from DB: ${messagesFromDatabase.length}`);

      if (messagesFromDatabase && messagesFromDatabase.length > 0) {
        threadMessages = messagesFromDatabase.map((message) =>
          JSON.parse(message.dataValues.rawApiResponse)
        );
        foundFromDb = true;
      }
    } catch (e) {}

    // get emails from the database
    if (!threadMessages) {
      const { messages } = await _getThreadEmails(targetThreadId);

      logger.debug(`> Threads Result from API: ${messages.length}`);

      threadMessages = messages;
    }

    logger.debug(
      `> Found and start processing ${threadMessages.length} messages`
    );

    for (let message of threadMessages) {
      const { id, threadId } = message;
      const messageDate = message.internalDate;

      // store raw content
      if (foundFromDb !== true) {
        await Models.RawContent.create({
          messageId: id,
          threadId: threadId,
          rawApiResponse: JSON.stringify(message),
        }).catch(() => {});
      }

      let rawBody = "";
      const parts = _flattenGmailPayloadParts(message.payload);
      if (parts && parts.length > 0) {
        for (let part of parts) {
          const { mimeType, partId } = part;

          const { size, attachmentId, data } = part.body;
          const fileName = part.filename;

          logger.debug(`> Parsing Part of Message: ${partId} - ${mimeType}`);

          if (size === 0) {
            // no body or data
            continue;
          } else if (attachmentId) {
            logger.debug(`> Parsing Message Attachment: ${mimeType}`);

            // is attachment, then download it
            const attachment = {
              mimeType,
              attachmentId,
              fileName,
            };
            const attachmentPath = await _parseGmailAttachment(id, attachment);

            if (attachmentPath) {
              attachments.push({
                id: attachment.attachmentId,
                messageId: id,
                mimeType: attachment.mimeType,
                fileName: attachment.fileName,
                path: attachmentPath,
              });
            }
          } else {
            // regular file
            logger.debug(`> Parse Message: ${mimeType}`);
            switch (mimeType) {
              case "multipart/alternative":
              case "multipart/related":
                logger.info(
                  "> Unsupported mimeType",
                  `threadId=${message.threadId}`,
                  `id=${message.id}`,
                  mimeType
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
                  messageId: id,
                  mimeType: mimeType,
                  fileName: inlineFileName,
                  path: newFilePath,
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

      const from = _parseEmailAddress(headers.from);

      const to = _parseEmailAddressList(headers.to);

      const bcc = _parseEmailAddressList(headers.bcc);

      const subject = (headers.subject || "").trim();

      const date = new Date(headers.date).getTime() || messageDate;

      const body =
        parseHtmlBody(rawBody) ||
        parseHtmlBodyWithoutParser(rawBody) ||
        rawBody; // attempt at using one of the parser

      const messageToUse = {
        id,
        threadId,
        from: from || null,
        body: body || null,
        rawBody: rawBody || null,
        headers: JSON.stringify(headers),
        to: to.join(",") || null,
        bcc: bcc.join(",") || null,
        date,
        subject: subject || null,
      };

      messagesToReturn.push(messageToUse);

      // store the message itself
      logger.debug(
        `> Saving message: threadId=${threadId} id=${id} subject=${subject}`
      );
      await Models.Email.create(messageToUse).catch((err) => {
        // attempt to do update
        return Models.Email.update(messageToUse, {
          where: {
            id: messageToUse.id,
          },
        }).catch((err) => {});
      });
    }

    // save attachments
    logger.debug(`> Saving ${attachments.length} attachments`);
    for (let attachment of attachments) {
      await Models.Attachment.create(attachment).catch((err) => {
        // attempt to do update
        return Models.Attachment.update(attachment, {
          where: {
            id: attachment.id,
          },
        }).catch((err) => {});
      });
    }

    resolve(messagesToReturn);
  });
}

/**
 * parse a list of emails
 * @param emailAddressesAsString
 */
function _parseEmailAddressList(emailAddressesAsString) {
  return (emailAddressesAsString || "")
    .split(/[ ]/)
    .filter((email) => !!email)
    .map((emailAddress) => {
      try {
        return _parseEmailAddress(emailAddress);
      } catch (e) {
        return emailAddress;
      }
    })
    .filter((email) => !!email && email.includes("@"));
}

/**
 * parse a single email
 * @param emailAddress
 */
function _parseEmailAddress(emailAddress) {
  return emailAddress
    .match(/<?[a-zA-Z0-9-_\.]+@[a-zA-Z0-9-_\.]+>?/)[0]
    .replace(/<?>?/g, "")
    .toLowerCase()
    .trim();
}

/**
 * get a list of threads to process
 */
async function _getThreadsToProcess() {
  const crawlFromLastToken = process.env.GMAIL_USE_LAST_PAGE_TOKEN === "true";
  const filePathThreadList = `./gmail.threads.data`;
  const filePathLastToken = `./gmail.threads_last_tokens.data`;

  let pageToken = "";
  let threadIds = [];

  try {
    threadIds = JSON.parse(fs.readFileSync(filePathThreadList));
  } catch (e) {
    // not in cache
    logger.info("> Not found in cache, start fetching thread list");
  }

  if (crawlFromLastToken !== true) {
    logger.info("> Return email threads from cache");
    return threadIds;
  } else {
    try {
      pageToken = fs
        .readFileSync(filePathLastToken, "UTF-8")
        .split("\n")
        .map((r) => r.trim())
        .filter((r) => !!r);
      pageToken = pageToken[pageToken.length - 1] || "";
    } catch (e) {}
  }

  let pageToLookAt = process.env.GMAIL_PAGES_TO_CRAWL || 1;
  logger.info(
    `> Crawl list of email threads: totalPages=${pageToLookAt} lastToken=${pageToken}`
  );

  let allThreads = [];

  while (pageToLookAt > 0) {
    pageToLookAt--;

    try{
      const { threads, nextPageToken } = await _getThreads(pageToken);
      allThreads = [...allThreads, ...(threads || []).map((r) => r.id)];
      pageToken = nextPageToken;

      if (!nextPageToken) {
        break;
      }

      fs.appendFileSync(filePathLastToken, nextPageToken + "\n");

      if (pageToLookAt % 25 === 0 && pageToLookAt > 0) {
        logger.info(`> ${pageToLookAt} pages of threads left`);
      } else if (pageToLookAt === 0) {
        logger.info(`> Done get thread list`);
      }
    } catch(e){
      logger.error(`> Failed to get thread list pageToken=${pageToken}  error=${e}`)
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
  fs.writeFileSync(filePathThreadList, JSON.stringify(threadIds, null, 2));


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
    // logger.info("> Download attachment: ", newFilePath);

    // if not, then download from upstream
    const attachmentResponse = await _getAttachment(
      messageId,
      attachment.attachmentId
    );

    _saveBase64DataToFile(newFilePath, attachmentResponse);

    return newFilePath;
  } else {
    // logger.info("> Skipped attachment: ", newFilePath);
    return null; // null indicated that we don't need to download, and ignored this entry entirely
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
    logger.info("> Error cannot save binary: ", newFilePath);
  }
}

function _getHeaders(headers) {
  return headers.reduce((res, header) => {
    res[header.name.toLowerCase()] = header.value;
    return res;
  }, {});
}

async function _processEmails() {
  const threadIds = await _getThreadsToProcess();
  const totalThreadCount = threadIds.length;
  logger.info("Total Threads:", totalThreadCount);

  let totalMsgCount = 0;
  let processedThreadCount = 0;
  for (let threadId of threadIds) {
    const percentDone = (
      (processedThreadCount / totalThreadCount) *
      100
    ).toFixed(2);

    if (
      processedThreadCount % 250 === 0 ||
      (percentDone % 20 === 0 && percentDone > 0)
    ) {
      logger.info(
        `> ${percentDone}% (${processedThreadCount} / ${totalThreadCount})`
      );
    }
    processedThreadCount++;

    // search for the thread
    const _messages = await _processMessagesByThreadId(threadId);
    totalMsgCount += _messages.length;
  }

  logger.info("Total Messages:", totalMsgCount);
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
    case "text/plain":
    case "text/xml":
    case "application/xml":
    case "application/json":
      mimeType = "text/plain";
      break;
  }

  let mimeTypeToUse = "";
  if (["text/csv", "application/vnd.ms-excel"].includes(mimeType)) {
    mimeTypeToUse = "application/vnd.google-apps.spreadsheet";
  } else if (
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
      "text/html",
    ].includes(mimeType)
  ) {
    mimeTypeToUse = "application/vnd.google-apps.document";
  } else if (
    [
      "application/vnd.ms-powerpoint",
      // "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ].includes(mimeType)
  ) {
    mimeTypeToUse = "application/vnd.google-apps.presentation";
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
  const mimeType = "application/vnd.google-apps.folder";

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
export function doWorkForAllItems() {
  logger.debug(`Doing work for all items`);
  return _processEmails();
}

/**
 * entry point to start work on a single item
 * @param targetThreadId
 */
export function doWorkSingle(targetThreadId) {
  logger.debug(`Doing work for single item ${targetThreadId}`);
  return _processMessagesByThreadId(targetThreadId);
}

export default doWorkForAllItems;
