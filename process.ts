// @ts-nocheck
require("dotenv").config();
const fs = require("fs");

import { Email } from "./src/types";
import { GMAIL_TO_PROCESS_PATH } from "./src/gmailCrawler";

const myEmails = (process.env.MY_EMAIL || "").split("|||");
const mySignatureTokens = (process.env.MY_SIGNATURE || "").split("|||");

const PROCESSED_EMAIL_PREFIX_PATH = "./processed";

const files = fs.readdirSync(GMAIL_TO_PROCESS_PATH);
const totalMessageCount = files.length;
console.log("Total Files To Process:", totalMessageCount);

let processedMessageCount = 0;
files.forEach((file) => {
  processedMessageCount++;

  const percentDone = ((processedMessageCount / totalMessageCount) * 100).toFixed(2);
  if (percentDone % 20 === 0 || processedMessageCount % 100 === 0) {
    console.log(`> ${percentDone}%`);
  }

  const email: Email = JSON.parse(
    fs.readFileSync(`${GMAIL_TO_PROCESS_PATH}/${file}`)
  );

  const { theadId, id, body, from, bcc, to } = email;
  const { subject } = email.headers;
  const toEmailList = bcc.concat(to);

  try{
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
  } catch(e){
    console.error("> Error: ", theadId, id, from, to);
  }
});
