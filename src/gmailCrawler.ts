// @ts-nocheck
const base64 = require("js-base64").Base64;
const fs = require("fs");
const jsdom = require("jsdom");
const readline = require("readline");
const { google } = require("googleapis");

import { Email, Headers, DatabaseResponse } from "src/types";
import * as Models from "./modelsSchema";

const { JSDOM } = jsdom;

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
    gmail.users.threads.get(
      {
        userId: "me",
        id: targetThreadId,
      },
      async (err, res) => {
        if (err) reject("The API returned an error: " + err);
        else {
          const messagesToReturn: Email[] = [];
          const { messages } = res.data;
          for (let message of messages) {
            const { id, threadId } = message;

            let body = "";
            let attachments: Attachment[] = [];
            if (message.payload.parts) {
              for (let part of message.payload.parts) {
                const { mimeType } = part;

                switch (mimeType) {
                  case "text/plain":
                    body = _parseGmailMessage(part.body.data);
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
              body = _parseGmailMessage(message.payload.body.data);
            }

            const headers: Headers = _getHeaders(message.payload.headers || []);

            const from = _parseEmailAddress(headers.from);

            const to = _parseEmailAddressList(headers.to || "");

            const bcc = _parseEmailAddressList(headers.bcc);

            const subject = (headers.subject || "").trim();

            const date = new Date(headers.date).getTime();

            messagesToReturn.push({
              id,
              threadId,
              from,
              body,
              attachments,
              headers,
              to,
              bcc,
              date,
              subject,
            });
          }

          resolve(messagesToReturn);
        }
      }
    );
  }).then((messages) => {
    if (foundInCached !== true) {
      // store into the db
      for (let message of messages) {
        // save to db
        Models.Email.create({
          id: message.id,
          threadId: message.threadId,
          from: message.from,
          subject: message.subject || null,
          body: message.body || null,
          to: message.to.join(",") || null,
          bcc: message.bcc.join(",") || null,
          date: message.date,
          attachmentIds:
            message.attachments
              .map((attachment) => attachment.attachmentId)
              .join(",") || null,
          content: JSON.stringify(message, null, 2),
        }).catch((err) => {
          console.error(
            "> Insert Failed",
            `threadId=${message.threadId}`,
            `id=${message.id}`,
            message.subject,
            message.body.substr(0, 30)
          );

          console.log(err);
        });
      }
    }

    return messages;
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

  return allThreads;
}

export function _parseGmailMessage(bodyData) {
  let result = "";
  const decodedBody = base64.decode(
    bodyData.replace(/-/g, "+").replace(/_/g, "/")
  );
  try {
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
  } catch (e) {}
  return result || decodedBody;
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
    const _messages = await _getMessagesByThreadId(thread.id);
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
