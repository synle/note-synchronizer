// @ts-nocheck
require("dotenv").config();
import axios from "axios";
import fs from 'fs';
import { Email, DatabaseResponse, Attachment } from "./src/types";
import initDatabase from "./src/models/modelsFactory";
import Models from "./src/models/modelsSchema";
import {
  init as initGoogleApi,
  uploadFile,
  parseHtmlBody,
  parseHtmlTitle,
} from "./src/crawler/gmailCrawler";

const myEmails = (process.env.MY_EMAIL || "").split("|||");
const mySignatureTokens = (process.env.MY_SIGNATURE || "").split("|||");
const ignoredTokens = (process.env.IGNORED_TOKEN || "").split("|||");

const PROCESSED_EMAIL_PREFIX_PATH = "./processed";

const used_mime_type = {};

function _isStringUrl(string){
  const REGEX_URL = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/

  return (string.match(REGEX_URL) || []).length > 0;
}


async function _crawlUrl(url){
  const response = await axios(url).catch((err) => console.log(err));
  if (response.status !== 200) {
    console.log("Error occurred while fetching data");
    return;
  }
  const rawHtmlBody = response.data;

  return {
    subject: parseHtmlTitle(rawHtmlBody),
    body: parseHtmlBody(rawHtmlBody),
  };
}

async function _doWork() {
  await initDatabase();
  await initGoogleApi();

  const matchedEmailsResponse: DatabaseResponse<
    Email
  >[] = await Models.Email.findAll({
    include: [
      {
        model: Models.Attachment,
        required: false,
      },
    ],
  });

  const totalMessageCount = matchedEmailsResponse.length;
  console.log("Total Files To Process:", totalMessageCount);

  let processedMessageCount = 0;

  for (let i = 0; i < matchedEmailsResponse.length; i++) {
    processedMessageCount++;
    const percentDone = (
      (processedMessageCount / totalMessageCount) *
      100
    ).toFixed(2);
    if (percentDone % 20 === 0 || processedMessageCount % 100 === 0) {
      console.log(`> ${percentDone}% (${processedMessageCount}/${totalMessageCount})`);
    }


    const email: Email = matchedEmailsResponse[i].dataValues;

    let { threadId, id, body, from, bcc, to, subject } = email;
    const toEmailList = (bcc || '').split(',').concat((to || '').split(','));
    const attachments : Attachment[] = email.Attachments.map(a => a.dataValues);


    subject = (subject || '').trim();
    body = (body || '').trim();

    if (
      myEmails.some((myEmail) => from.includes(myEmail)) &&
      myEmails.some((myEmail) =>
        toEmailList.some((toEmail) => toEmail.includes(myEmail))
      )
    ) {
      if (_isStringUrl(subject)){
        // if subject is a url
        const urlToCrawl = subject;

        // crawl the URL for title
        const websiteRes = await _crawlUrl(urlToCrawl);

        body = `${urlToCrawl}\n\n${websiteRes.body}`;
        subject = websiteRes.subject;
      } else {
      }

      // ignored if content contains the ignored patterns
      if (ignoredTokens.some(ignoredToken => body.toLowerCase().includes(ignoredToken))) {
        console.log('> Skipped due to Ignored Pattern: ', subject);
        continue;// skipped
      }

      // upload the doc itself
      // only log email if there're some content
      if(body.length > 0){
        const localPath = `${PROCESSED_EMAIL_PREFIX_PATH}/processed.${email.id}.data`;

        const fileContent = `${subject}\n${id}/${threadId}\n\n${body || ""}`;

        fs.writeFileSync(localPath, fileContent.trim());

        const docFileName = subject;
        try {
          await uploadFile(
            docFileName,
            "text/plain",
            localPath,
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
        const attachmentName = `${docFileName} - #${AttachmentIdx} - ${attachment.fileName}`;

        used_mime_type[attachment.mimeType] = true;

        try {
          await uploadFile(
            attachmentName,
            attachment.mimeType,
            attachment.path,
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

  console.log('Used Attachment Mimetypes:');
  console.log(Object.keys(used_mime_type).join('\n'));
}

_doWork();
