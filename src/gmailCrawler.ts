// @ts-nocheck
const base64 = require("js-base64").Base64;
const fs = require("fs");
const jsdom = require("jsdom");
const readline = require("readline");
const { google } = require("googleapis");

import { Email, Headers } from "src/types";

const useCache = true;

const { JSDOM } = jsdom;

const GMAIL_CACHE_PATH = "./caches";
export const GMAIL_TO_PROCESS_PATH = "./processing"; // store all the messages to be process

let gmail;

// google crawler
// If modifying these scopes, delete token.json.
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const GMAIL_TOKEN_PATH = "token.json";
const GMAIL_CREDENTIALS_PATH = "credentials.json";

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  // Check if we have previously stored a token.
  fs.readFile(GMAIL_TOKEN_PATH, (err, token) => {
    if (err) return getNewToken(oAuth2Client, callback);
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
function getNewToken(oAuth2Client, callback) {
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
 * Lists the labels in the user's account.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function listLabels() {
  gmail.users.labels.list(
    {
      userId: "me",
    },
    (err, res) => {
      if (err) return console.log("The API returned an error: " + err);
      const labels = res.data.labels;
      if (labels.length) {
        console.log("Labels:");
        labels.forEach((label) => {
          console.log(`- ${label.name}`);
        });
      } else {
        console.log("No labels found.");
      }
    }
  );
}

function _getThreads(pageToken) {
  return new Promise((resolve, reject) => {
    gmail.users.threads.list(
      {
        userId: "me",
        pageToken,
      },
      (err, res) => {
        if (err) reject("The API returned an error: " + err);
        else resolve(res.data);
      }
    );
  });
}

function _getMessagesByThreadId(id): Promise<Email[]> {
  return new Promise((resolve, reject) => {
    const filePath = `${GMAIL_CACHE_PATH}/gmail.thread.${id}.data`;
    try {
      if (useCache) {
        return resolve(JSON.parse(fs.readFileSync(filePath)));
      }
    } catch (e) {
      // not in cache
    }

    gmail.users.threads.get(
      {
        userId: "me",
        id,
      },
      (err, res) => {
        if (err) reject("The API returned an error: " + err);
        else {
          const messagesToReturn: Email[] = [];
          const { messages } = res.data;
          for (let message of messages) {
            const { id, threadId } = message;

            let body = "";
            let attachments = [];
            if (message.payload.parts) {
              for (let part of message.payload.parts) {
                const { mimeType } = part;

                switch (mimeType) {
                  case "text/plain":
                    body = _decodeGmailMessage(part.body.data);
                    break;
                  default:
                    const attachmentId = part.body.attachmentId;
                    const fileName = part.filename;

                    if (attachmentId && fileName) {
                      attachments.push({
                        mimeType,
                        attachmentId,
                        fileName,
                      });
                    }
                    break;
                }
              }
            } else if (message.payload.body) {
              body = _decodeGmailMessage(message.payload.body.data);
            }

            const headers: Headers = _getHeaders(message.payload.headers || []);

            const from = _parseEmailAddress(headers.from);

            const to = _parseEmailAddressList(headers.to || "");

            const bcc = _parseEmailAddressList(headers.bcc);

            messagesToReturn.push({
              id,
              threadId,
              body,
              attachments,
              headers,
              from,
              to,
              bcc,
              date: new Date(headers.date).getTime(),
            });
          }

          fs.writeFileSync(filePath, JSON.stringify(messagesToReturn, null, 2));
          resolve(messagesToReturn);
        }
      }
    );
  });
}

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

function _parseEmailAddress(emailAddress) {
  return emailAddress
    .match(/<?[a-zA-Z0-9-_\.]+@[a-zA-Z0-9-_\.]+>?/)[0]
    .replace(/<?>?/g, "")
    .toLowerCase()
    .trim();
}

async function getThreadsToProcess() {
  const filePath = `${GMAIL_CACHE_PATH}/gmail.threads.data`;
  try {
    if (useCache) {
      return JSON.parse(fs.readFileSync(filePath));
    }
  } catch (e) {
    // not in cache
  }

  let pageToLookAt = process.env.GMAIL_PAGES_TO_CRAWL || 1;
  let pageToken = "";
  let allThreads = [];
  while (pageToLookAt > 0) {
    const { threads, nextPageToken, resultSizeEstimate } = await _getThreads(
      pageToken
    );
    allThreads = [...allThreads, ...threads];
    pageToken = nextPageToken;
    pageToLookAt--;
  }

  // cache it
  fs.writeFileSync(
    filePath,
    JSON.stringify(
      allThreads.map((r) => {
        delete r.snippet; // clean up the data
        return r;
      }),
      null,
      2
    )
  );

  return allThreads;
}

export function _decodeGmailMessage(bodyData) {
  let result = "";
  const decodedBody = base64.decode(
    bodyData.replace(/-/g, "+").replace(/_/g, "/")
  );
  const dom = new JSDOM(decodedBody);
  result = dom.window.document.body.textContent
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

  if (!result) {
    result = decodedBody;
  }
  return result;
}

function _getHeaders(headers) {
  return headers.reduce((res, header) => {
    res[header.name.toLowerCase()] = header.value;
    return res;
  }, {});
}

async function processEmails(gmail) {
  const allThreads = await getThreadsToProcess();
  const totalThreadCount = allThreads.length;
  console.log("Total Threads:", totalThreadCount);

  let totalMsgCount = 0;
  let processedThreadCount = 0;
  for (let thread of allThreads) {
    processedThreadCount++;

    const percentDone = (
      (processedThreadCount / totalThreadCount) *
      100
    ).toFixed(2);
    if (processedThreadCount % 500 === 0 || percentDone % 20 === 0) {
      console.log(`> ${percentDone}%`);
    }

    // search for the thread
    const messages = await _getMessagesByThreadId(thread.id);

    for (let message of messages) {
      totalMsgCount++;

      fs.writeFileSync(
        `${GMAIL_TO_PROCESS_PATH}/to_process.${message.id}.data`,
        JSON.stringify(message, null, 2)
      );
    }
  }

  console.log("Total Messages:", totalMsgCount);
}

export function init(onAfterInitFunc) {
  // Load client secrets from a local file.
  fs.readFile(GMAIL_CREDENTIALS_PATH, (err, content) => {
    if (err) return console.log("Error loading client secret file:", err);
    // Authorize a client with credentials, then call the Gmail API.
    authorize(JSON.parse(content), function (auth) {
      gmail = google.gmail({ version: "v1", auth });
      onAfterInitFunc(gmail);
    });
  });
}

export default function _doWork() {
  init(processEmails);
}
