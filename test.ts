// @ts-nocheck
require("dotenv").config();
import { initLogger, logger } from "./src/loggers";
initLogger(`Test.Ts`);
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
  const noteDestinationFolderId = await googleApiUtils.createNoteDestinationFolder();
  console.debug(`NOTE_DESTINATION_FOLDER_ID=${noteDestinationFolderId}`);
}

async function _doWork1() {
  const res = await crawlUrl(
    "www.cnet.com/news/iphone-se-these-are-the-best-prepaid-plans-for-apples-399-iphone/"
  );
  console.log(res.subject);
}

async function _doWork2() {
  // const threadId = '10b81ba511e00280';
  const threadId = "15f37ccd402aa1f4";

  const emails = await DataUtils.getEmailsByThreadId(threadId);

  const sections = [];
  const subject = emails[0].rawSubject;
  for (let email of emails) {
    const attachments = await DataUtils.getAttachmentsByMessageId(email.id);
    sections.push({
      body: email.body,
      images: attachments,
    });
  }

  try {
    const fileName = "./www.test.docx";

    await gdriveCrawler.generateDocFile2(subject, sections, fileName);

    // // first do a create operation
    // const resp1 = await googleApiUtils.uploadFile({
    //   name: fileName,
    //   mimeType: MIME_TYPE_ENUM.APP_MS_DOCX,
    //   localPath: fileName,
    //   description: "test html file 1",
    //   date: email.date,
    //   starred: false,
    //   parentFolderId: "1c3KO8SOVv_era9g6uATFWGSG55Vhajf3",
    //   appProperties: {
    //     aaa: 111,
    //     bbb: 222,
    //   },
    // });

    // const fileId = resp1.id;
    // console.log(fileId);

    // // then do the update operation
    // await googleApiUtils.uploadFile({
    //   name: fileName,
    //   mimeType: MIME_TYPE_ENUM.APP_MS_DOCX,
    //   localPath: fileName,
    //   description: "test html file 2",
    //   date: email.date,
    //   starred: false,
    //   parentFolderId: "1c3KO8SOVv_era9g6uATFWGSG55Vhajf3",
    //   appProperties: {
    //     aaa: 111,
    //     bbb: 222,
    //   },
    // });
    // console.log(resp1);
  } catch (e) {
    console.log(e.stack);
  }
}

async function _doWork3() {
  const messageId = "17198550f061f1ce";
  const email = await DataUtils.getEmailByMessageId(messageId);
  console.log(JSON.stringify(email, null, 2));
  process.exit();
}

async function _doWork4() {
  const data = `<a href="http://www.nytimes.com/2011/02/27/your-money/27fund.html?_r=1&amp;ref=business" >http://www.nytimes.com/2011/02/27/your-money/27fund.html?_r=1&amp;ref=business</a > <div><br /></div> <div>Nam</div>`;

  var data2 = gmailCrawler.tryParseBody(data);
  console.log(data2);
}

async function _doWork5() {
  const folderList = await googleApiUtils.searchDrive({
    mimeType: MIME_TYPE_ENUM.APP_GOOGLE_FOLDER,
    parentFolderId: process.env.NOTE_DESTINATION_FOLDER_ID,
  });

  console.log(folderList[0]);
  console.log(folderList.length);
}

async function _doWork6() {
  await DataUtils.restartAllWork();
}

async function _doWork7() {
  async function _fetchParseAndSync(threadId) {
    try {
      await gmailCrawler.fetchRawContentsByThreadId(threadId);
      await gmailCrawler.processMessagesByThreadId(threadId);
      await gdriveCrawler.uploadEmailThreadToGoogleDrive(threadId);
    } catch (er) {}
  }

  const threadsToProcess = [
    // original list
    "14404d899de83c36",
    "141342c03104e72d",
    "14199ee7acc840f9",
    "13fc454319136988",
    "13a3ce255c265bad",
    "17324ffd0c280b31",
    "16bae8875b72b130",
    "129d4fbc87d13213",
    "1598525f698fdec9",
    "1475f62ce0f78dcd",
    "14404d899de83c36",
    "1167c7a9d3b0a6e0",
    // // new list
    "123976eec8413f5a",
    "123c90be52944dfe",
    "123da37c6d7a585d",
    "124602bd25ddc420",
    "124ab8d7591f09af",
    "124da3360d4db2d0",
    "1250afc62d08be5e",
    "12512d4147aab0b2",
    "1251d8f69a11f7ce",
    "1252ca817b31097e",
    "1252ce1ab4e38b28",
    "1256a281f4740d7d",
    "127dee48997e4a4f",
    "134c057c9208dd04",
    "14261eb158ea05f1",
    "14c2980a8b2f9921",
    "1595e30dea677bd6",
    "15c1f309fc6ac924",
    "15dd9874c2f7ddb0",
    "15dd98f7442cb09f",
    "15dd990e793e4101",
    "15dd997634ced869",
    "15f1384c52f61827",
    "15fab8718f53f8ad",
    "15fcab405d893716",
    "161b622e8c917d0d",
    "161e76ccf2cb4171",
    "1626dd29a59c5e8f",
    "1630fa941f2f5807",
    "1631343f857ccf97",
    "163aeea0c88d3c3c",
    "1653e0931ecdc760",
    "1655f85bda5eddaa",
    "1659dd08de75e2de",
    "1659dd16dd4b6b05",
    "165ddba871cd6709",
    "1661d698f8ad28b1",
    "166a41ed81a15ca4",
    "166c593175c3c4d6",
    "16805a0c5470429c",
    "1692717ddefa838b",
    "169ff14e3441257d",
    "16ac99f542b78b7d",
    "16af75c45e3f0c95",
  ];

  for (const threadId of threadsToProcess) {
    logger.debug(`Staring processing for threadId=${threadId}`);
    await _fetchParseAndSync(threadId);
  }
}

async function _start() {
  await _init();

  await _doWork2();
  //await _doWork0();
  // await _doWork6();
  //await _doWork3();
  //await _doWork4();
  //await _doWork7();
  // await _doWork7();
  process.exit();
}

_start();
