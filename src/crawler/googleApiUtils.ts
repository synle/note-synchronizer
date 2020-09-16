// @ts-nocheck
import fs from "fs";
import readline from "readline";
import { google } from "googleapis";
import moment from "moment";
import { generateFolderName } from "./commonUtils";
import { MIME_TYPE_ENUM, myEmails } from "./appConstantsEnums";
import * as commonUtils from "./commonUtils";
import * as DataUtils from "./dataUtils";
import { logger } from "../loggers";

let gmailApiInstance;
let driveApiInstance;

let noteDestinationFolderId = process.env.NOTE_DESTINATION_FOLDER_ID;

// google auth apis
// If modifying these scopes, delete token.json.
const GOOGLE_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/drive",
];

// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const GOOGLE_OAUTH_TOKEN_PATH = "token.json";

function _logAndWrapApiError(err, res, ...extra) {
  logger.error(
    `Gmail API Failed: \nError=${JSON.stringify(err)} \nRes=${JSON.stringify(
      res
    )}`
  );

  console.error(
    `Gmail API Failed:`,
    extra
      .map((s) => {
        if (s === null) {
          return "NULL";
        }
        if (s === undefined) {
          return "UNDEFINED";
        }
        return JSON.stringify(s);
      })
      .join(", "),
    JSON.stringify(err.stack || err),
    res
  );

  return err;
}

export async function getNoteDestinationFolderId() {
  if (!noteDestinationFolderId) {
    // not there, then create it
    logger.debug(
      `getNoteDestinationFolderId attempted at create the folder noteDestinationFolderId=${noteDestinationFolderId}`
    );
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

  // create the attachment folder
  const attachmentDestFolderId = await createDriveFolder({
    name: '_attachments',
    description: 'Attachments',
    parentFolderId: noteDestFolderId,
    starred: true,
    folderColorRgb: "#FFFF00",
    appProperties: {
      AttachmentFolder: "1",
    },
  });

  logger.warn(
    `createNoteDestinationFolder noteFolderId=${noteDestFolderId} attachmentFolderId=${attachmentDestFolderId}`
  );


  // generate the bucket for all of my emails
  let promises = [];
  const folderNames = await DataUtils.getAllParentFolders();

  logger.warn(
    `createNoteDestinationFolder create child folders totalChildFolders=${folderNames.length}`
  );
  for (const parentFolderName of folderNames) {
    const starred = parentFolderName.indexOf("_") === 0;

    promises.push(
      createDriveFolder({
        name: parentFolderName,
        description: `Chats & Emails from ${parentFolderName}`,
        parentFolderId: noteDestFolderId,
        starred,
        folderColorRgb: starred ? "#FF0000" : "#0000FF",
        appProperties: {
          fromDomain: parentFolderName,
        },
      })
    );

    if (promises.length === 3) {
      await Promise.allSettled(promises);
      promises = [];
    }
  }

  await Promise.allSettled(promises);

  return noteDestFolderId;
}

/**
 * api used to init to be called to get the gmail api setup
 * @param onAfterInitFunc
 */
export function initGoogleApi(onAfterInitFunc = () => {}) {
  return new Promise((resolve, reject) => {
    // Load client secrets from a local file.
    // Authorize a client with credentials, then call the Gmail API.
    const oAuthSettings = {
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
      redirect_uris: ["urn:ietf:wg:oauth:2.0:oob", "http://localhost"].concat(
        (process.env.GOOGLE_OAUTH_REDIRECT_URLS || "").split(",")
      ),
      project_id: process.env.GOOGLE_OAUTH_PROJECT_ID,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    };
    authorizeGoogle(oAuthSettings, async function (auth) {
      gmailApiInstance = google.gmail({ version: "v1", auth });
      driveApiInstance = google.drive({ version: "v3", auth });
      onAfterInitFunc(gmailApiInstance, driveApiInstance);
      resolve();
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
  const { client_secret, client_id, redirect_uris } = credentials;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  // Check if we have previously stored a token.
  fs.readFile(GOOGLE_OAUTH_TOKEN_PATH, (err, token) => {
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
    scope: GOOGLE_OAUTH_SCOPES,
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
      fs.writeFile(GOOGLE_OAUTH_TOKEN_PATH, JSON.stringify(token), (err) => {
        if (err) return console.error(err);
        console.info("Token stored to", GOOGLE_OAUTH_TOKEN_PATH);
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
        resolve(res.data.id);
      }
    );
  });
}

export function updateFileInDrive(fileId, resource, media) {
  return new Promise((resolve, reject) => {
    driveApiInstance.files.update(
      {
        fileId,
        fields: "id",
        media,
        addParents: resource.parents.join(','),
        requestBody: {
          name: resource.name,
          description: resource.description,
          starred: resource.starred,
          useContentAsIndexableText: resource.useContentAsIndexableText,
          enforceSingleParent: resource.enforceSingleParent,
          keepRevisionForever: resource.keepRevisionForever,
          appProperties: resource.appProperties,
        },
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
        resolve(res.data.id);
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
          return reject(
            _logAndWrapApiError(err, res, "createFolderInDrive", resource)
          );
        }
        resolve(res.data.id);
      }
    );
  });
}

export function searchDrive(
  { name, mimeType, parentFolderId, appProperties },
  skippedPaging = true
) {
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

  logger.debug(`searchDrive q=${q}`);

  return new Promise(async (resolve, reject) => {
    try {
      let nextPageToken = null;
      let resultFiles = [];
      while (nextPageToken || nextPageToken === null) {
        const result = await searchFilesByQuery(q, nextPageToken);
        nextPageToken = result.nextPageToken;
        resultFiles = resultFiles.concat(result.files || []);
        if (skippedPaging) {
          break;
        }
      }
      resolve(resultFiles);
    } catch (err) {
      reject(err);
    }
  });
}

function searchFilesByQuery(q, nextPageToken) {
  const query = {
    fields: "nextPageToken, files(id, name)",
    spaces: "drive",
    pageSize: 1000,
  };
  if (nextPageToken) {
    query[nextPageToken] = nextPageToken;
  } else {
    query[q] = q;
  }

  logger.debug(
    `searchFilesByQuery q=${JSON.stringify(q)} nextPageToken=${nextPageToken}`
  );

  return new Promise((resolve, reject) => {
    driveApiInstance.files.list(
      {
        q,
      },
      function (err, res) {
        if (err) {
          return reject(
            _logAndWrapApiError(
              err,
              res,
              "searchFilesByQuery",
              q,
              nextPageToken
            )
          );
        }
        resolve(res.data);
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
      name,
      mimeType,
      parentFolderId: parentFolderId,
      // appProperties,
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
      logger.debug(`Create Google Drive Folder ${name}`);
      return createFolderInDrive(fileGDriveMetadata);
    } else {
      logger.debug(
        `Skipped Create Google Drive Folder ${name} due to duplicate`
      );
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
  attachmentId,
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
      MIME_TYPE_ENUM.APP_ICS,
      MIME_TYPE_ENUM.APP_XML,
      MIME_TYPE_ENUM.APP_JSON,
      MIME_TYPE_ENUM.APP_RTF,
      MIME_TYPE_ENUM.APP_MS_DOC,
      MIME_TYPE_ENUM.APP_MS_DOCX,
      // MIME_TYPE_ENUM.APP_APPLE_IWORK,
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
      .concat(attachmentId ? process.env.ATTACHMENT_DESTINATION_FOLDER_ID || "" : "")
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
    `Upload file with ${
      foundFileId ? "UPDATE" : "CREATE"
    } parent=${parentFolderId} fileName=${name} fileId=${
      foundFileId || ""
    } fileGDriveMetadata=${JSON.stringify(fileGDriveMetadata)}`
  );

  if (foundFileId) {
    return updateFileInDrive(foundFileId, fileGDriveMetadata, media);
  } else {
    return createFileInDrive(fileGDriveMetadata, media);
  }
}
