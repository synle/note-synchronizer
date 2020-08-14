// @ts-nocheck
require("dotenv").config();
const fs = require("fs");

import { Email, DatabaseResponse, Attachment } from "./src/types";
import initDatabase from "./src/models/modelsFactory";
import * as Models from "./src/models/modelsSchema";

const myEmails = (process.env.MY_EMAIL || "").split("|||");
const mySignatureTokens = (process.env.MY_SIGNATURE || "").split("|||");

const PROCESSED_EMAIL_PREFIX_PATH = "./processed";

async function _doWork() {
  await initDatabase();

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
  console.log("Total Files To Process:", matchedEmailsResponse.length);

  let processedMessageCount = 0;

  for (let i = 0; i < matchedEmailsResponse.length; i++) {
    processedMessageCount++;
    const percentDone = (
      (processedMessageCount / totalMessageCount) *
      100
    ).toFixed(2);
    if (percentDone % 20 === 0 || processedMessageCount % 100 === 0) {
      console.log(`> ${percentDone}%`);
    }


    const email: Email = matchedEmailsResponse[i].dataValues;

    const { theadId, id, body, from, bcc, to, subject } = email;
    const toEmailList = (bcc || '').split(',').concat((to || '').split(','));
    const attachments : Attachment[] = email.Attachments.map(a => a.dataValues);

    try {
      if (
        myEmails.some((myEmail) => from.includes(myEmail)) &&
        myEmails.some((myEmail) =>
          toEmailList.some((toEmail) => toEmail.includes(myEmail))
        )
      ) {
        fs.writeFileSync(
          `${PROCESSED_EMAIL_PREFIX_PATH}/processed.${email.id}.data`,
          JSON.stringify(email, null, 2)
        );
      }
    } catch (e) {
      console.error("> Error: ", theadId, id, from, to);
    }
  }
}

_doWork();
