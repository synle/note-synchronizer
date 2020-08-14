// @ts-nocheck
require("dotenv").config();

import fs from 'fs';

import { init, _decodeGmailMessage } from "./src/crawler/gmailCrawler";
import initDatabase from "./src/models/modelsFactory";
import * as Models from "./src/models/modelsSchema";
import { Email, DatabaseResponse } from "./src/types";
import { init as initGoogleApi, uploadFile } from "./src/crawler/gmailCrawler";



async function _doWork(){
  //  get drive files
  //  init(
  //    function(gmail, drive){
  //     drive.files.list(
  //       {
  //         pageSize: 1000  ,
  //         fields: "*",
  //       },
  //       (err, res) => {
  //         if (err) return console.log("The API returned an error: " + err);
  //         const files = res.data.files;
  //         console.log(JSON.stringify(res.data, null, 2));
  //         if (files.length) {
  //           console.log("Files:");
  //           // files.map((file) => {
  //           //   console.log(`${file.name} (${file.id})`);
  //           // });
  //         } else {
  //           console.log("No files found.");
  //         }
  //       }
  //     );
  //    }
  //  )

  // upload file
  init(
    async function(gmail, drive){
      try {
        await uploadFile(
          "aaa2.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          `./attachments/Aaa.docx`,
          process.env.NOTE_GDRIVE_FOLDER_ID
        );
      } catch (e) {
        console.error(
          JSON.stringify(e, null, 2)
        );
      }
    }
  );

  // upload file
  // init(
  //   function(gmail, drive){
  //     const folderId = '1Kgi5txtdu4wPxlxpHLXWD4muVGhpWNng';
  //     var fileMetadata = {
  //       name: "aaa.doc",
  //       parents: [folderId],
  //       mimeType: "application/vnd.google-apps.document",
  //     };
  //     var media = {
  //       mimeType:
  //         "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  //       body: fs.createReadStream(`./attachments/Aaa.docx`),
  //     };
  //     drive.files.create({
  //       resource: fileMetadata,
  //       media: media,
  //       fields: 'id'
  //     }, function (err, file) {
  //       console.log(err, file);
  //       if (err) {
  //         // Handle error
  //         console.error(err);
  //       } else {
  //         console.log('File Id: ', file);
  //       }
  //     });
  //   }
  // );


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


  // // set up db
  // await initDatabase();

  // // create
  // // await Models.Email.create({
  // //   id: "173bb34fc2dd5d4b",
  // //   content: 'some_content'
  // // });

  // // find
  // const matchedEmailsResponse: DatabaseResponse<
  //   Email
  // >[] = await Models.Email.findAll({
  //   where: {
  //     threadId: "173bb34fc2dd5d4b",
  //   },
  // });
  // const matchedEmails: Email[] = [];
  // for (let i = 0; i < matchedEmailsResponse.length; i++){
  //   matchedEmails.push(matchedEmailsResponse[i].dataValues);
  // }
  // console.log(matchedEmails[0], matchedEmails.length);
}

_doWork()
