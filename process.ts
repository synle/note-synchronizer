// @ts-nocheck
require("dotenv").config();
import fs from 'fs';
import { Email, DatabaseResponse, Attachment } from "./src/types";
import initDatabase from "./src/models/modelsFactory";
import * as Models from "./src/models/modelsSchema";
import {init as initGoogleApi, uploadFile} from './src/crawler/gmailCrawler';

const myEmails = (process.env.MY_EMAIL || "").split("|||");
const mySignatureTokens = (process.env.MY_SIGNATURE || "").split("|||");
const ignoredTokens = (process.env.IGNORED_TOKEN || "").split("|||");

const PROCESSED_EMAIL_PREFIX_PATH = "./processed";

const used_mime_type = {};

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

    if (
      myEmails.some((myEmail) => from.includes(myEmail)) &&
      myEmails.some((myEmail) =>
        toEmailList.some((toEmail) => toEmail.includes(myEmail))
      )
    ) {
      body = body.trim();
      subject = subject.trim()

      // if content contains the ignored patterns, then skip this
      if (ignoredTokens.some(ignoredToken => body.includes(ignoredToken))) {
        console.log('> Ignored: ', subject);
        continue;
      }

      const localPath = `${PROCESSED_EMAIL_PREFIX_PATH}/processed.${email.id}.data`;

      const fileContent = `${subject}\n${id}/${threadId}\n\n${body || ""}`;

      fs.writeFileSync(localPath, fileContent.trim());

      // upload the doc itself
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
