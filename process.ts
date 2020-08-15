// @ts-nocheck
require("dotenv").config();
import axios from "axios";
import fs from "fs";
import { Email, DatabaseResponse, Attachment } from "./src/types";
import initDatabase from "./src/models/modelsFactory";
import Models from "./src/models/modelsSchema";
import { JSDOM } from "jsdom";
import {
  init as initGoogleApi,
  uploadFile,
  parseHtmlBody,
  parseHtmlTitle,
} from "./src/crawler/gmailCrawler";

const myEmails = (process.env.MY_EMAIL || "").split("|||");
const mySignatureTokens = (process.env.MY_SIGNATURE_TOKEN || "").split("|||");
const ignoredTokens = (process.env.IGNORED_TOKEN || "").split("|||");

const PROCESSED_EMAIL_PREFIX_PATH = "./processed";

const used_mime_type = {};

const REGEX_URL = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/;

function _isStringUrl(string) {
  return (string.match(REGEX_URL) || []).length > 0;
}

function _extractUrlFromString(string) {
  return string.match(REGEX_URL)[0];
}

async function _crawlUrl(url) {
  try {
    const response = await axios(url).catch((err) => console.log(err));
    if (!response || response.status !== 200) {
      console.error("> Error crawlUrl: ", url, response && response.status);
      return;
    }
    const rawHtmlBody = response.data;

    return {
      subject: parseHtmlTitle(rawHtmlBody) || "",
      body: rawHtmlBody,
    };
  } catch (e) {
    console.error("> Error crawlUrl: ", url);
  }
}

async function _doWork() {
  await initDatabase();
  await initGoogleApi();

  const matchedEmailsResponse: DatabaseResponse<
    Email
  >[] = await Models.Email.findAll({
    where: {},
    include: [
      {
        model: Models.Attachment,
        required: false,
      },
    ],
  });

  const totalMessageCount = matchedEmailsResponse.length;
  console.log(" > Total Messages To Process:", totalMessageCount);

  let processedMessageCount = 0;

  for (let i = 0; i < matchedEmailsResponse.length; i++) {
    const percentDone = (
      (processedMessageCount / totalMessageCount) *
      100
    ).toFixed(2);
    if (
      percentDone === 0 ||
      percentDone % 20 === 0 ||
      processedMessageCount % 100 === 0
    ) {
      console.log(
        `> ${percentDone}% (${processedMessageCount}/${totalMessageCount})`
      );
    }
    processedMessageCount++;

    const email: Email = matchedEmailsResponse[i].dataValues;

    let { threadId, id, body, rawBody, from, bcc, to, subject, date } = email;
    const toEmailList = (bcc || "").split(",").concat((to || "").split(","));
    const attachments: Attachment[] = (email.Attachments || [])
      .map((a) => a.dataValues)
      .filter((attachment) => {
        // only use attachments that is not small images
        const attachmentStats = fs.statSync(attachment.path);
        return (
          attachmentStats.size < 30000 &&
          attachment.mimeType.includes("images/") === 0
        );
      });

    subject = (subject || "").trim();

    body = body || "";
    for (let signature of mySignatureTokens) {
      body = body.replace(signature, "");
    }
    body = body.trim();

    rawBody = (rawBody || "").trim();
    let docFileName = subject;

    const isEmailSentToMySelf =
      myEmails.some((myEmail) => from.includes(myEmail)) &&
      myEmails.some((myEmail) =>
        toEmailList.some((toEmail) => toEmail.includes(myEmail))
      );

    const hasSomeAttachments = attachments.length > 0;

    if (isEmailSentToMySelf || hasSomeAttachments) {
      if (_isStringUrl(subject)) {
        // if subject is a url
        const urlToCrawl = _extractUrlFromString(subject);

        // crawl the URL for title
        console.log(" > Crawling subject with url", id, urlToCrawl);
        const websiteRes = await _crawlUrl(urlToCrawl);

        if (websiteRes && websiteRes.subject) {
          subject = (websiteRes.subject || "").trim();
          body = `<a href='${urlToCrawl}'>${urlToCrawl}</a><hr />${websiteRes.body}`.trim();
        }
      } else if (body.length < 255 && _isStringUrl(body)) {
        // if body is a url
        const urlToCrawl = _extractUrlFromString(body);
        if (urlToCrawl) {
          // crawl the URL for title
          console.log(" > Crawling body with url", id, urlToCrawl);
          const websiteRes = await _crawlUrl(urlToCrawl);
          if (websiteRes && websiteRes.subject) {
            subject = `${subject} - ${websiteRes.subject || ""}`.trim();
            body = `<a href='${urlToCrawl}'>${urlToCrawl}</a><hr />${websiteRes.body}`.trim();
          }
        }
      } else {
        // anything else use raw body
        body = rawBody;
      }

      // ignored if content contains the ignored patterns
      if (
        ignoredTokens.some((ignoredToken) =>
          body.toLowerCase().includes(ignoredToken)
        ) ||
        ignoredTokens.some((ignoredToken) =>
          subject.toLowerCase().includes(ignoredToken)
        )
      ) {
        console.log(" > Skipped due to Ignored Pattern: ", subject);
        continue; // skipped
      }

      // upload the doc itself
      // only log email if there're some content
      if (body.length > 0) {
        const localPath = `${PROCESSED_EMAIL_PREFIX_PATH}/processed.${email.id}.data`;

        docFileName = subject;

        try {
          const fileContent = `
          <h1>${subject}</h1>
          <hr />
          <div><b><u>from:</u></b> ${from}</div>
          <div><b><u>threadId:</u></b> ${threadId}</div>
          <div><b><u>messageId:</u></b> ${id}</div>
          <hr />
          ${body}`.trim();
          fs.writeFileSync(localPath, fileContent.trim());

          await uploadFile(
            docFileName,
            "text/html",
            localPath,
            `ThreadId=${threadId} MessageId=${id} Main Email`,
            date,
            process.env.NOTE_GDRIVE_FOLDER_ID
          );
        } catch (e) {
          console.error(
            "> Error - Failed to upload original note: ",
            threadId,
            id,
            docFileName,
            localPath,
            JSON.stringify(e, null, 2)
          );
        }
      }

      // then upload the associated attachments
      let AttachmentIdx = 0;
      for (let attachment of attachments) {
        AttachmentIdx++;
        const attachmentName = `${docFileName} - #${AttachmentIdx} - ${attachment.fileName}`;

        used_mime_type[attachment.mimeType] = true;

        try {
          await uploadFile(
            attachmentName,
            attachment.mimeType,
            attachment.path,
            `ThreadId=${threadId} MessageId=${id} Attachment #${AttachmentIdx}`,
            date,
            process.env.NOTE_GDRIVE_FOLDER_ID
          );
        } catch (e) {
          console.error(
            "> Error - Failed to upload attachment: ",
            threadId,
            id,
            attachmentName,
            attachment.path,
            JSON.stringify(e, null, 2)
          );
        }
      }
    }
  }

  console.log(" > Used Attachment Mimetypes:");
  console.log(Object.keys(used_mime_type).join("\n"));
}

_doWork();
