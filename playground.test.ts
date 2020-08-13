// @ts-nocheck
require("dotenv").config();

import { init, _decodeGmailMessage } from "./src/gmailCrawler";
import initDatabase from "./src/modelsFactory";
import * as Models from "./src/modelsSchema";
import { Email, DatabaseResponse } from "./src/types";




async function _doWork(){
  // get email thread by id
  // init(
  //   function(gmail){
  //     const id = "173bb34fc2dd5d4b";
  //     gmail.users.threads.get(
  //       {
  //         userId: "me",
  //         id,
  //       },
  //       (err, res) => {
  //         console.log(JSON.stringify(res.data, null, 2));
  //         console.log(_decodeGmailMessage(res.data.messages[0].payload.body.data));
  //       }
  //     );
  //   }
  // )


  // set up db
  await initDatabase();

  // create
  // await Models.Email.create({
  //   id: "173bb34fc2dd5d4b",
  //   content: 'some_content'
  // });

  // find
  const matchedEmailsResponse: DatabaseResponse<
    Email
  >[] = await Models.Email.findAll({
    where: {
      threadId: "173bb34fc2dd5d4b",
    },
  });
  const matchedEmails: Email[] = [];
  for (let i = 0; i < matchedEmailsResponse.length; i++){
    matchedEmails.push(matchedEmailsResponse[i].dataValues);
  }
  console.log(matchedEmails[0], matchedEmails.length);
}

_doWork()
