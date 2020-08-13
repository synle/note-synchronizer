// @ts-nocheck
require("dotenv").config();

import { init, _decodeGmailMessage } from "./src/gmailCrawler";
import initDatabase from "./src/modelsFactory";
import * as AllModelMaps from "./src/modelsSchema";



async function _doWork(){
  // get email thread by id
  // init(
  //   function(gmail){
  //     const id = "123";
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

  await AllModelMaps.Email.create({
    id: "123",
    content: 'some_content'
  });
}

_doWork()
