// @ts-nocheck
import fs from "fs";
import readline from "readline";
import { google } from "googleapis";
import moment from "moment";
import { MIME_TYPE_ENUM, myEmails } from "./commonUtils";
import { logger } from "../loggers";
import { generateFolderName } from "./gdriveCrawler";

let gmailApiInstance;
let driveApiInstance;

let noteDestinationFolderId = process.env.NOTE_DESTINATION_FOLDER_ID;

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

function _logAndWrapApiError(err, res, ...extra) {
  logger.error(
    `Gmail API Failed: \nError=${JSON.stringify(err)} \nRes=${JSON.stringify(
      res
    )}`
  );

  console.error(
    `Gmail API Failed:`,
    extra.map(JSON.stringify).join(", "),
    err.stack || err,
    res
  );

  return err;
}

export async function getNoteDestinationFolderId() {
  if (!noteDestinationFolderId) {
    // not there, then create it
    noteDestinationFolderId = await createNoteDestinationFolder();
  }

  return noteDestinationFolderId;
}

export async function createNoteDestinationFolder() {
  const noteFolderName = process.env.NOTE_DESTINATION_FOLDER_NAME;

  const noteDestFolderId = await createDriveFolder({
    name: noteFolderName,
    description: noteFolderName,
    starred: true,
    folderColorRgb: "#FFFF00",
    appProperties: {
      EmailNoteFolder: "1",
    },
  });

  // generate the bucket for all of my emails
  const promiseQueue = [];
  for (const myEmail of myEmails) {
    const fromEmailDomain = generateFolderName(myEmail);

    promiseQueue.push(
      createDriveFolder({
        name: fromEmailDomain,
        description: `Chats & Emails from ${fromEmailDomain}`,
        parentFolderId: noteDestFolderId,
        starred: true,
        folderColorRgb: "#FF0000",
        appProperties: {
          fromDomain: fromEmailDomain,
        },
      })
    );
  }

  await Promise.allSettled(promiseQueue);

  return noteDestFolderId;
}

/**
 * api used to init to be called to get the gmail api setup
 * @param onAfterInitFunc
 */
export function initGoogleApi(onAfterInitFunc = () => {}) {
  logger.debug("initGoogleApi Begin");

  return new Promise((resolve, reject) => {
    // Load client secrets from a local file.
    fs.readFile(GMAIL_CREDENTIALS_PATH, (err, content) => {
      if (err) return reject("Error loading client secret file:" + err);
      // Authorize a client with credentials, then call the Gmail API.
      authorizeGoogle(JSON.parse(content), async function (auth) {
        gmailApiInstance = google.gmail({ version: "v1", auth });
        driveApiInstance = google.drive({ version: "v3", auth });

        onAfterInitFunc(gmailApiInstance, driveApiInstance);
        logger.debug("initGoogleApi Done");

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
      if (err) return console.error("Error retrieving access token", err);
      oAuth2Client.setCredentials(token);
      // Store the token to disk for later program executions
      fs.writeFile(GMAIL_TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.info("Token stored to", GMAIL_TOKEN_PATH);
      });
      callback(oAuth2Client);
    });
  });
}
// google core apis

// gmails apis
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
          return reject(_logAndWrapApiError(err, res, "getGmailLabels"));
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
        maxResults: process.env.GMAIL_MAX_THREAD_RESULT || 500, // so far the max is 500
      },
      (err, res) => {
        if (err) {
          return reject(
            _logAndWrapApiError(err, res, "getThreadsByQuery", q, pageToken)
          );
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
function _getThreadEmailsByThreadId(targetThreadId) {
  return new Promise((resolve, reject) => {
    gmailApiInstance.users.threads.get(
      {
        userId: "me",
        id: targetThreadId,
      },
      (err, res) => {
        if (err) {
          return reject(
            _logAndWrapApiError(
              err,
              res,
              "getThreadEmailsByThreadId",
              targetThreadId
            )
          );
        }
        resolve(res.data);
      }
    );
  });
}

function _getDraftsByThreadId(targetThreadId) {
  return new Promise((resolve, reject) => {
    gmailApiInstance.users.drafts.get(
      {
        userId: "me",
        id: targetThreadId,
      },
      (err, res) => {
        if (err) {
          return reject(
            _logAndWrapApiError(err, res, "getDraftsByThreadId", targetThreadId)
          );
        }
        resolve(res.data);
      }
    );
  });
}

export function getEmailContentByThreadId(targetThreadId) {
  try {
    return _getThreadEmailsByThreadId(targetThreadId);
  } catch (err) {}

  try {
    return _getDraftsByThreadId(targetThreadId);
  } catch (err) {}

  // if not found at all
  logger.error(
    `Cannot find content in message for draft GMAIL API for threadId=${targetThreadId}`
  );
  return Promise.reject(`Cannot find content for threadId${targetThreadId}`);
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
          return reject(
            _logAndWrapApiError(
              err,
              res,
              "getEmailAttachment",
              messageId,
              attachmentId
            )
          );
        }
        resolve(res.data.data);
      });
  });
}

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
          return reject(
            _logAndWrapApiError(
              err,
              res,
              "sendEmail",
              to,
              subject,
              message,
              from
            )
          );
        }
        resolve(res.data);
      }
    );
  });
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

// google drive apis
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
          return reject(
            _logAndWrapApiError(err, res, "createFileInDrive", resource, media)
          );
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
          return reject(
            _logAndWrapApiError(
              err,
              res,
              "updateFileInDrive",
              fileId,
              resource,
              media
            )
          );
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
          _logAndWrapApiError(err, res, "createFolderInDrive", resource)
          return null;
        }
        resolve(res.data.id);
      }
    );
  });
}

export function searchDrive({ name, mimeType, parentFolderId, appProperties }) {
  const queries = [];

  queries.push(`trashed=false`);

  if (name) {
    queries.push(`name='${_sanatizeGoogleQuery(name)}'`);
  }

  if (parentFolderId) {
    queries.push(`parents in '${_sanatizeGoogleQuery(parentFolderId)}'`);
  }

  if (mimeType) {
    queries.push(`mimeType='${_sanatizeGoogleQuery(mimeType)}'`);
  }

  if (appProperties) {
    const propKeys = Object.keys(appProperties);
    for (const propKey of propKeys) {
      const propValue = appProperties[propKey];
      queries.push(
        `appProperties has { key='${_sanatizeGoogleQuery(
          propKey
        )}' and value='${_sanatizeGoogleQuery(propValue)}'}`
      );
    }
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
          return reject(
            _logAndWrapApiError(
              err,
              res,
              "searchDrive",
              name,
              mimeType,
              parentFolderId
            )
          );
        }
        resolve(res.data.files);
      }
    );
  });
}

export async function createDriveFolder({
  name,
  description,
  parentFolderId,
  starred = false,
  folderColorRgb = "FFFF00",
  appProperties = {},
}) {
  try {
    const mimeType = MIME_TYPE_ENUM.APP_GOOGLE_FOLDER;

    const matchedResults = await searchDrive({
      mimeType,
      appProperties,
    });

    if (matchedResults.length === 0) {
      const fileGDriveMetadata = {
        name,
        mimeType,
        description,
        folderColorRgb,
        starred,
        appProperties,
      };

      if (parentFolderId) {
        fileGDriveMetadata.parents = [parentFolderId];
      }

      // create the folder itself
      return createFolderInDrive(fileGDriveMetadata);
    } else {
      return matchedResults[0].id;
    }
  } catch (err) {
    _logAndWrapApiError(err, null, "createDriveFolder");
    return null;
  }
}

export async function uploadFile({
  name,
  mimeType,
  localPath,
  description,
  dateEpochTime,
  starred = false,
  parentFolderId,
  appProperties = {},
}) {
  let mimeTypeToUse = (mimeType || "").toLowerCase();
  let keepRevisionForever = false;
  if (
    [
      MIME_TYPE_ENUM.TEXT_CSV,
      MIME_TYPE_ENUM.APP_MS_XLS,
      MIME_TYPE_ENUM.APP_MS_XLSX,
    ].includes(mimeType)
  ) {
    mimeTypeToUse = MIME_TYPE_ENUM.APP_GOOGLE_SPREADSHEET;
    keepRevisionForever = true;
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
      MIME_TYPE_ENUM.TEXT_JAVA,
      MIME_TYPE_ENUM.TEXT_JAVA_SOURCE,
      MIME_TYPE_ENUM.TEXT_CSHARP,
    ].includes(mimeType)
  ) {
    mimeTypeToUse = MIME_TYPE_ENUM.APP_GOOGLE_DOCUMENT;
    keepRevisionForever = true;
  } else if ([MIME_TYPE_ENUM.APP_OCTLET_STREAM].includes(mimeType)) {
    if (localPath.includes(".java")) {
      mimeTypeToUse = MIME_TYPE_ENUM.APP_GOOGLE_DOCUMENT;
      keepRevisionForever = true;
    }
  } else if (
    [MIME_TYPE_ENUM.APP_MS_PPT, MIME_TYPE_ENUM.APP_MS_PPTX].includes(mimeType)
  ) {
    mimeTypeToUse = MIME_TYPE_ENUM.APP_GOOGLE_PRESENTATION;
    keepRevisionForever = true;
  }

  const createdTime = moment.utc(dateEpochTime).format("YYYY-MM-DDTHH:mm:ssZ");
  const modifiedTime = moment.utc(dateEpochTime).format("YYYY-MM-DDTHH:mm:ssZ");

  // refer to this link for more metadata
  // https://developers.google.com/drive/api/v3/reference/files/create
  const fileGDriveMetadata = {
    name,
    parents: []
      .concat(parentFolderId || [])
      .filter((p) => !!p & (p.length > 0)),
    mimeType: mimeTypeToUse,
    modifiedTime,
    createdTime,
    viewedByMeTime: createdTime,
    description,
    starred,
    useContentAsIndexableText: true,
    enforceSingleParent: true,
    keepRevisionForever,
    appProperties,
  };

  if (fileGDriveMetadata.length === 0) {
    fileGDriveMetadata.parents = [process.env.NOTE_DESTINATION_FOLDER_ID];
  }

  const media = {
    mimeType,
    body: fs.createReadStream(localPath),
  };

  let foundFileId;
  if (!foundFileId) {
    const matchedResults = await searchDrive({
      appProperties: appProperties,
      parentFolderId: parentFolderId,
    });

    logger.debug(
      `Search GDrive results for file name=${fileGDriveMetadata.name} total=${matchedResults.length}`
    );

    if (matchedResults && matchedResults.length > 0) {
      foundFileId = matchedResults[0].id;
    }
  }

  console.debug(
    "Upload file with operation",
    foundFileId ? "Update" : "Create",
    `parent=${parentFolderId}`,
    name,
    foundFileId
  );

  if (foundFileId) {
    return updateFileInDrive(foundFileId, fileGDriveMetadata, media);
  } else {
    return createFileInDrive(fileGDriveMetadata, media);
  }
}
