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

let gmail;
let drive;

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

function _uploadFileToDrive(resource, media) {
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

function _searchFileInFolder(name, parentFolderId) {
  const q = `name='${name.replace(
    /'/g,
    "\\'"
  )}' AND trashed=false AND parents in '${parentFolderId}'`;

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
  console.log("Authorize this app by visiting this url:", authUrl);
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  rl.question("Enter the code from that page here: ", (code) => {
    rl.close();
    oAuth2Client.getToken(code, (err, token) => {
      if (err) return console.error("Error retrieving access token", err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(GMAIL_TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.log("Token stored to", GMAIL_TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}

/**
 * api to get the list of message by a thread id
 * @param targetThreadId
 */
function _getMessagesByThreadId(targetThreadId): Promise<Email[]> {
  let foundInCached = false;
  return new Promise(async (resolve, reject) => {
    // get from databases
    const matchedEmailsResponse: DatabaseResponse<
      Email
    >[] = await Models.Email.findAll({
      where: {
        threadId: targetThreadId,
      },
    });
    if (matchedEmailsResponse.length > 0) {
      foundInCached = true;
      return resolve(matchedEmailsResponse.map((r) => r.dataValues));
    }

    // get from gmail api
    const messagesToReturn: Email[] = [];
    const allAttachments = [];

    let threadMessages;
    let foundFromDb = false;

    // attempting at getting the emails from the database
    try {
      const messagesFromDatabase = await Models.RawContent.findAll({
        where: {
          threadId: targetThreadId,
        },
      });
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
      threadMessages = messages;
    }

    for (let message of threadMessages) {
      const { id, threadId } = message;

      // store raw content
      if (foundFromDb !== true) {
        await Models.RawContent.create({
          messageId: id,
          threadId: threadId,
          rawApiResponse: JSON.stringify(message),
        });
      }

      let rawBody = "";
      if (message.payload.parts) {
        for (let part of message.payload.parts) {
          const { mimeType } = part;

          const attachmentId = part.body.attachmentId;
          const fileName = part.filename;

          if (attachmentId && fileName) {
            // is attachment
            const attachment = {
              mimeType,
              attachmentId,
              fileName,
            };
            const attachmentPath = await _parseGmailAttachment(id, attachment);

            if (attachmentPath) {
              allAttachments.push({
                id: attachment.attachmentId,
                messageId: id,
                mimeType: attachment.mimeType,
                fileName: attachment.fileName,
                path: attachmentPath,
              });
            }
          } else {
            // regular file
            switch (mimeType) {
              default:
                console.log(
                  "> Unsupported mimeType",
                  `threadId=${message.threadId}`,
                  `id=${message.id}`,
                  mimeType
                );
                break;

              case "text/plain":
                if (!rawBody) {
                  // only store the rawbody if it's not already defined
                  rawBody = part.body.data;
                }
                break;
              case "text/html":
                rawBody = _parseGmailMessage(part.body.data);
                break;
            }
          }
        }
      } else if (message.payload.body) {
        rawBody = _parseGmailMessage(message.payload.body.data);
      }

      const headers: Headers = _getHeaders(message.payload.headers || []);

      const from = _parseEmailAddress(headers.from);

      const to = _parseEmailAddressList(headers.to);

      const bcc = _parseEmailAddressList(headers.bcc);

      const subject = (headers.subject || "").trim();

      const date = new Date(headers.date).getTime();

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
      await Models.Email.create(messageToUse).catch((err) => {
        console.error(
          "> Insert Message Failed",
          `threadId=${message.threadId}`,
          `id=${message.id}`,
          message.subject,
          err
        );

        console.log(err);
      });
    }

    // save attachments
    for (let attachment of allAttachments) {
      await Models.Attachment.create(attachment).catch((err) => {
        console.error(
          "> Insert Attachment Failed",
          JSON.stringify(attachment, null, 2)
        );
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
        // console.error("> cannot parse email", emailAddress);
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
  let pageToLookAt = process.env.GMAIL_PAGES_TO_CRAWL || 1;
  console.log("> Total Pages of Threads to crawl: ", pageToLookAt);

  const filePath = `./gmail.threads.data`;
  try {
    return JSON.parse(fs.readFileSync(filePath));
  } catch (e) {
    // not in cache
    console.log("> Not found in cache, start fetching thread list");
  }

  let pageToken = "";
  let allThreads = [];

  while (pageToLookAt > 0) {
    const { threads, nextPageToken } = await _getThreads(pageToken);
    allThreads = [...allThreads, ...threads];
    pageToken = nextPageToken;
    pageToLookAt--;

    if (pageToLookAt % 25 === 0 && pageToLookAt > 0) {
      console.log(`> ${pageToLookAt} pages of threads left`);
    } else if (pageToLookAt === 0) {
      console.log(`> Done get thread list`);
    }
  }

  // remove things we don't need
  allThreads = allThreads.map((r) => r.id);

  // cache it
  fs.writeFileSync(filePath, JSON.stringify(allThreads, null, 2));

  return allThreads;
}

/**
 * remove all script and styles
 * @param string
 */
export function _cleanHtml(string) {
  return string
    .replace(
      /<style( type="[a-zA-Z/+]+")?>[a-zA-Z0-9-_!*{:;}#.%,[^=\]@() \n\t\r"'/>?&~+]+<\/style>/gi,
      ""
    )
    .replace(
      /<script( type="[a-zA-Z/+]+")?>[a-zA-Z0-9-_!*{:;}#.%,[^=\]@() \n\t\r"'/>?&~+]+<\/script>/gi,
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
    // console.log("> Download attachment: ", newFilePath);

    // if not, then download from upstream
    const attachmentResponse = await _getAttachment(
      messageId,
      attachment.attachmentId
    );
    const data = attachmentResponse.replace(/-/g, "+").replace(/_/g, "/");

    fs.writeFileSync(newFilePath, data, "base64", function (err) {
      console.log(err);
    });

    return newFilePath;
  } else {
    // console.log("> Skipped attachment: ", newFilePath);
    return null; // null indicated that we don't need to download, and ignored this entry entirely
  }
}

function _getHeaders(headers) {
  return headers.reduce((res, header) => {
    res[header.name.toLowerCase()] = header.value;
    return res;
  }, {});
}

async function _processEmails(gmail) {
  const threadIds = await _getThreadsToProcess();
  const totalThreadCount = threadIds.length;
  console.log("Total Threads:", totalThreadCount);

  let totalMsgCount = 0;
  let processedThreadCount = 0;
  for (let threadId of threadIds) {
    const percentDone = (
      (processedThreadCount / totalThreadCount) *
      100
    ).toFixed(2);

    if (
      processedThreadCount % 1000 === 0 ||
      percentDone % 20 === 0
    ) {
      console.log(
        `> ${percentDone}% (${processedThreadCount} / ${totalThreadCount})`
      );
    }
    processedThreadCount++;

    // search for the thread
    const _messages = await _getMessagesByThreadId(threadId);
    totalMsgCount += _messages.length;
  }

  console.log("Total Messages:", totalMsgCount);
}

/**
 * api used to init to be called to get the gmail api setup
 * @param onAfterInitFunc
 */
export const init = (onAfterInitFunc = () => {}) => {
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
  const modifiedTime = moment.utc().format("YYYY-MM-DDTHH:mm:ssZ");

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

  const matchedFiles = await _searchFileInFolder(
    fileGDriveMetadata.name,
    parentFolderId
  );
  if (matchedFiles.length === 0) {
    return _uploadFileToDrive(fileGDriveMetadata, media);
  }
}

/**
 * entry point to start work
 */
function _doWork() {
  init(_processEmails);
}

export default _doWork;
