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
import { crawlUrl, myEmails, MIME_TYPE_ENUM } from "./src/crawler/commonUtils";

async function _init() {
  console.log("test inits");

  await initDatabase();
  await initGoogleApi();

  console.log("test starts");
}

async function _doWork0() {
  await _init();
  const noteDestinationFolderId = await googleApiUtils.createNoteDestinationFolder();
  console.debug(`Note Destintation Folder Id: ${noteDestinationFolderId}`);
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

  const attachments = await DataUtils.getAttachmentByMessageId(email.id);

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

  const messageId = "1076a77ef5631883";
  const email = await DataUtils.getEmailByMessageId(messageId);
  console.log(email.id, email.threadId);
}

//
// _doWork0();
_doWork3();
