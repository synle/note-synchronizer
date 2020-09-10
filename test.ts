// @ts-nocheck
require("dotenv").config();

globalThis.LOG_LEVEL = "debug";

import initDatabase from "./src/models/modelsFactory";

import { Op } from "sequelize";

import { initGoogleApi } from "./src/crawler/googleApiUtils";
import * as googleApiUtils from "./src/crawler/googleApiUtils";

import * as gmailCrawler from "./src/crawler/gmailCrawler";
import * as gdriveCrawler from "./src/crawler/gdriveCrawler";

import Models from "./src/models/modelsSchema";
import * as DataUtils from "./src/crawler/dataUtils";
import { crawlUrl } from "./src/crawler/commonUtils";
import { myEmails, MIME_TYPE_ENUM } from "./src/crawler/appConstantsEnums";

async function _init() {
  console.log("test inits");

  await initDatabase();
  await initGoogleApi();

  console.log("test starts");
}

async function _doWork0() {
  await _init();
  const noteDestinationFolderId = await googleApiUtils.createNoteDestinationFolder();
  console.debug(`NOTE_DESTINATION_FOLDER_ID=${noteDestinationFolderId}`);
}

async function _doWork1() {
  await _init();
  const res = await crawlUrl(
    "www.cnet.com/news/iphone-se-these-are-the-best-prepaid-plans-for-apples-399-iphone/"
  );
  console.log(res.subject);
}

async function _doWork2() {
  await _init();

  // const threadId = '10b81ba511e00280';
  const threadId = "17214ac6b31840a3";

  const emails = await DataUtils.getEmailsByThreadId(threadId);

  const email = emails[0];

  const attachments = await DataUtils.getAttachmentsByMessageId(email.id);

  console.log(attachments[0].path);
  console.log(attachments[0].fileName);
  console.log(attachments[0].mimeType);

  try {
    const fileName = "./www.test.docx";

    await gdriveCrawler.generateDocFile(
      email.subject,
      email.from,
      email.rawBody,
      attachments,
      fileName
    );

    // first do a create operation
    const resp1 = await googleApiUtils.uploadFile({
      name: fileName,
      mimeType: MIME_TYPE_ENUM.APP_MS_DOCX,
      localPath: fileName,
      description: "test html file 1",
      date: email.date,
      starred: false,
      parentFolderId: "1c3KO8SOVv_era9g6uATFWGSG55Vhajf3",
      appProperties: {
        aaa: 111,
        bbb: 222,
      },
    });

    const fileId = resp1.id;
    console.log(fileId);

    // then do the update operation
    await googleApiUtils.uploadFile({
      name: fileName,
      mimeType: MIME_TYPE_ENUM.APP_MS_DOCX,
      localPath: fileName,
      description: "test html file 2",
      date: email.date,
      starred: false,
      parentFolderId: "1c3KO8SOVv_era9g6uATFWGSG55Vhajf3",
      appProperties: {
        aaa: 111,
        bbb: 222,
      },
    });
    console.log(resp1);
  } catch (e) {
    console.log(e.stack);
  }
}

async function _doWork3() {
  await _init();

  const messageId = "17198550f061f1ce";
  const email = await DataUtils.getEmailByMessageId(messageId);
  // console.log(JSON.stringify(email, null, 2));
}

async function _doWork4() {
  await _init();
  const data = `<a href="http://www.nytimes.com/2011/02/27/your-money/27fund.html?_r=1&amp;ref=business" >http://www.nytimes.com/2011/02/27/your-money/27fund.html?_r=1&amp;ref=business</a > <div><br /></div> <div>Nam</div>`;

  var data2 = gmailCrawler.tryParseBody(data);
  console.log(data2);
}

async function _doWork5() {
  await _init();

  const folderList = await googleApiUtils.searchDrive({
    mimeType: MIME_TYPE_ENUM.APP_GOOGLE_FOLDER,
    parentFolderId: process.env.NOTE_DESTINATION_FOLDER_ID,
  });

  console.log(folderList[0]);
  console.log(folderList.length);
}

async function _doWork6() {
  await _init();
  await DataUtils.restartAllWork();
}

async function _doWork7() {
  await _init();
  // // const threadId = "128205fe247fbde5";
  // const threadId = "140885a4be3eaf1a";
  // await gdriveCrawler.uploadEmailThreadToGoogleDrive(threadId);

  await gdriveCrawler.uploadEmailMsgToGoogleDrive("13ab8e6433968907");
}

//
//_doWork0();
// _doWork6();
//_doWork3();
//_doWork4();
//_doWork7();

_doWork3();
