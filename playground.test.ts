// @ts-nocheck
require("dotenv").config();

import { init, _decodeGmailMessage } from "./src/gmailCrawler";

init(
  function(gmail){
    const id = "123";
    gmail.users.threads.get(
      {
        userId: "me",
        id,
      },
      (err, res) => {
        console.log(JSON.stringify(res.data, null, 2));
        console.log(_decodeGmailMessage(res.data.messages[0].payload.body.data));
      }
    );
  }
)
