// @ts-nocheck
import fs from "fs";
import readline from "readline";
import { google } from "googleapis";
import moment from "moment";
import { MIME_TYPE_ENUM } from "./commonUtils";
import { logger } from "../loggers";

let gmailApiInstance;
let driveApiInstance;

let noteDestinationFolderId;

// google auth apis
// If modifying these scopes, delete token.json.
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/drive",
];

// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const GMAIL_TOKEN_PATH = "token.json";
const GMAIL_CREDENTIALS_PATH = "credentials.json";

export function getNoteDestinationFolderId() {
  return noteDestinationFolderId;
}

/**
 * api used to init to be called to get the gmail api setup
 * @param onAfterInitFunc
 */
export function initGoogleApi(onAfterInitFunc = () => {}) {
  return new Promise((resolve, reject) => {
    // Load client secrets from a local file.
    fs.readFile(GMAIL_CREDENTIALS_PATH, (err, content) => {
      if (err) return reject("Error loading client secret file:" + err);
      // Authorize a client with credentials, then call the Gmail API.
      authorizeGoogle(JSON.parse(content), async function (auth) {
        gmailApiInstance = google.gmail({ version: "v1", auth });
        driveApiInstance = google.drive({ version: "v3", auth });

        // create the note folder
        noteDestinationFolderId = await createDriveFolder(
          process.env.NOTE_DESTINATION_FOLDER_NAME,
          "Note Synchronizer Destination Folder"
        );

        onAfterInitFunc(gmailApiInstance, driveApiInstance);

        resolve();
      });
    });
  });
}

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorizeGoogle(credentials, callback) {
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  // Check if we have previously stored a token.
  fs.readFile(GMAIL_TOKEN_PATH, (err, token) => {
    if (err) return getNewGoogleToken(oAuth2Client, callback);
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
function getNewGoogleToken(oAuth2Client, callback) {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });
  logger.info(`Authorize this app by visiting this url: ${authUrl}`);
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
// google core apis

/**
 * Lists the labels in the user's account.
 */
function getGmailLabels() {
  return new Promise((resolve, reject) => {
    gmailApiInstance.users.labels.list(
      {
        userId: "me",
      },
      (err, res) => {
        if (err) {
          logger.error(
            `Gmail API Failed: \nError=${JSON.stringify(
              err
            )} \nRes=${JSON.stringify(res)}`
          );
          return reject(err);
        }
        resolve(res.data.labels);
      }
    );
  });
}

/**
 * api to get the list of threads
 * @param q
 * @param pageToken
 */
export function getThreadsByQuery(q, pageToken) {
  return new Promise((resolve, reject) => {
    gmailApiInstance.users.threads.list(
      {
        userId: "me",
        pageToken,
        q,
        maxResults: 500, // so far the max is 500
      },
      (err, res) => {
        if (err) {
          logger.error(
            `Gmail API Failed: \nError=${JSON.stringify(
              err
            )} \nRes=${JSON.stringify(res)}`
          );
          return reject(err);
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
export function getThreadEmailsByThreadId(targetThreadId) {
  return new Promise((resolve, reject) => {
    gmailApiInstance.users.threads.get(
      {
        userId: "me",
        id: targetThreadId,
      },
      (err, res) => {
        if (err) {
          logger.error(
            `Gmail API Failed: \nError=${JSON.stringify(
              err
            )} \nRes=${JSON.stringify(res)}`
          );
          return reject(err);
        }
        resolve(res.data);
      }
    );
  });
}

export function getEmailAttachment(messageId, attachmentId) {
  return new Promise((resolve, reject) => {
    gmailApiInstance.users.messages.attachments
      .get({
        id: attachmentId,
        messageId,
        userId: "me",
      })
      .then((res, err) => {
        if (err) {
          logger.error(
            `Gmail API Failed: \nError=${JSON.stringify(
              err
            )} \nRes=${JSON.stringify(res)}`
          );
          return reject(err);
        }
        resolve(res.data.data);
      });
  });
}

export function createFileInDrive(resource, media) {
  return new Promise((resolve, reject) => {
    driveApiInstance.files.create(
      {
        resource,
        media,
        fields: "id",
      },
      function (err, res) {
        if (err) {
          logger.error(
            `Gmail API Failed: \nError=${JSON.stringify(
              err
            )} \nRes=${JSON.stringify(res)}`
          );
          return reject(err);
        }
        resolve(res.data);
      }
    );
  });
}

export function updateFileInDrive(fileId, resource, media) {
  return new Promise((resolve, reject) => {
    driveApiInstance.files.update(
      {
        fileId,
        media,
        fields: "id",
      },
      function (err, res) {
        if (err) {
          logger.error(
            `Gmail API Failed: \nError=${JSON.stringify(
              err
            )} \nRes=${JSON.stringify(res)}`
          );
          return reject(err);
        }
        resolve(res.data);
      }
    );
  });
}

export function createFolderInDrive(resource) {
  return new Promise((resolve, reject) => {
    driveApiInstance.files.create(
      {
        resource,
        fields: "id",
      },
      function (err, res) {
        if (err) {
          logger.error(
            `Gmail API Failed: \nError=${JSON.stringify(
              err
            )} \nRes=${JSON.stringify(res)}`
          );
          return reject(err);
        }
        resolve(res.data);
      }
    );
  });
}

export function searchDrive(name, mimeType, parentFolderId) {
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

  logger.debug(`Searching Google Drive: ${q}`);

  return new Promise((resolve, reject) => {
    driveApiInstance.files.list(
      {
        q,
        fields: "nextPageToken, files(id, name)",
        spaces: "drive",
      },
      function (err, res) {
        if (err) {
          logger.error(
            `Gmail API Failed: \nError=${JSON.stringify(
              err
            )} \nRes=${JSON.stringify(res)}`
          );
          return reject(err);
        }
        resolve(res.data.files);
      }
    );
  });
}

export async function createDriveFolder(name, description, parentFolderId) {
  const mimeType = MIME_TYPE_ENUM.APP_GOOGLE_FOLDER;

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

export async function uploadFile(
  name,
  mimeType,
  localPath,
  description,
  dateEpochTime,
  starred = false,
  parentFolderId
) {
  let mimeTypeToUse = (mimeType || "").toLowerCase();
  if (
    [
      MIME_TYPE_ENUM.TEXT_CSV,
      MIME_TYPE_ENUM.APP_MS_XLS,
      MIME_TYPE_ENUM.APP_MS_XLSX,
    ].includes(mimeType)
  ) {
    mimeTypeToUse = MIME_TYPE_ENUM.APP_GOOGLE_SPREADSHEET;
  } else if (
    [
      MIME_TYPE_ENUM.APP_XML,
      MIME_TYPE_ENUM.APP_JSON,
      MIME_TYPE_ENUM.APP_RTF,
      MIME_TYPE_ENUM.APP_MS_DOC,
      MIME_TYPE_ENUM.APP_MS_DOCX,
      MIME_TYPE_ENUM.TEXT_X_AMP_HTML,
      MIME_TYPE_ENUM.TEXT_HTML,
      MIME_TYPE_ENUM.TEXT_PLAIN,
      MIME_TYPE_ENUM.TEXT_XML,
    ].includes(mimeType)
  ) {
    mimeTypeToUse = MIME_TYPE_ENUM.APP_GOOGLE_DOCUMENT;
  } else if (
    [MIME_TYPE_ENUM.APP_MS_PPT, MIME_TYPE_ENUM.APP_MS_PPTX].includes(mimeType)
  ) {
    mimeTypeToUse = MIME_TYPE_ENUM.APP_GOOGLE_PRESENTATION;
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
    starred,
    useContentAsIndexableText: true,
    enforceSingleParent: true,
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
    console.debug(
      "Upload file with create operation",
      `parent=${parentFolderId}`,
      name
    );
    return createFileInDrive(fileGDriveMetadata, media);
  } else {
    console.debug(
      "Upload file with update operation",
      `parent=${parentFolderId}`,
      name,
      matchedResults[0].id
    );
    return updateFileInDrive(matchedResults[0].id, fileGDriveMetadata, media);
  }
}

// other minor things / utils
function _sanatizeGoogleQuery(string) {
  return (string || "").replace(/'/g, "\\'");
}

export function flattenGmailPayloadParts(initialParts) {
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

function _makeMessageBody(
  to,
  subject,
  message,
  from = process.env.MY_MAIN_EMAIL
) {
  var str = [
    'Content-Type: text/plain; charset="UTF-8"\n',
    "MIME-Version: 1.0\n",
    "Content-Transfer-Encoding: 7bit\n",
    "to: ",
    to,
    "\n",
    "from: ",
    from,
    "\n",
    "subject: ",
    subject,
    "\n\n",
    message,
  ].join("");

  var encodedMail = Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return encodedMail;
}

// ready to be used
export function sendEmail(to, subject, message, from) {
  return new Promise((resolve, reject) => {
    gmailApiInstance.users.messages.send(
      {
        userId: "me",
        resource: {
          raw: _makeMessageBody(to, subject, message, from),
        },
      },
      function (err, res) {
        if (err) {
          logger.error(
            `Gmail API Failed: \nError=${JSON.stringify(
              err
            )} \nRes=${JSON.stringify(res)}`
          );
          return reject(err);
        }
        resolve(res.data);
      }
    );
  });
}
