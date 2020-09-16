// @ts-nocheck
require("dotenv").config();
import { initLogger, logger } from "./src/loggers";
initLogger(`Test.Ts.${Date.now()}`);
globalThis.LOG_LEVEL = "debug";

import StreamZip from "node-stream-zip";
import fs from "fs";
import path from "path";
import mimeTypes from "mime-types";

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
      /* await gmailCrawler.fetchRawContentsByThreadId(threadId);
      await gmailCrawler.processMessagesByThreadId(threadId); */
      await gdriveCrawler.uploadEmailThreadToGoogleDrive(threadId);
    } catch (er) {
      console.log(er);
    }
  }

  let threadsToProcess = [
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
    "13e9fc0b05b4631a",
    // "14ea74e274335d1e", // long email thread with lots of attachments
  ];

  threadsToProcess = "1308f784b0b82f7f";
  threadsToProcess = [
    "143c7bc48bb3f184",
    "16ac96f75343b94c",
    "12f4be2e3e1c0458",
    "17035347608bc95a",
  ];

  threadsToProcess = "1308f784b0b82f7f";

  threadsToProcess = [
    "11f0542e79269927",
    "10b81ba511e00280",
    "12cc9ea930e8176e",
    "10b81ba511e00280",
    "119ce063a0d77489",
    "11e155e60f00436f",
    "11f0542e79269927",
    "11f8afbf7a21797d",
    "1208780732443cc6",
    "120f4e0c3763abea",
    "1211ec049d0f0d2f",
    "1223a0c8ffbd8866",
    "123c90be52944dfe",
    "123cb552e5ac6719",
    "123cb82bc7d72086",
    "123f9e2254a81204",
    "124602bd25ddc420",
    "124ab8d7591f09af",
    "124ab914c3f82256",
    "12512d4147aab0b2",
    "125466beb5d3323c",
    "1255bd5917100175",
    "12565cab145fdca2",
    "12569f62e3cea779",
    "1256a281f4740d7d",
    "1265ea46c98c9ee7",
    "126bb1584945d489",
    "126dfd448adf5ee1",
    "126ecf837904b62e",
    "126f374bc1d134c2",
    "126f6d9b9241b4e2",
    "12702d55dbb958e0",
    "1270350979af3de4",
    "12704b27ef331c5d",
    "12706abe682747f5",
    "12727c38e6c7b654",
    "1276fb32d69a0936",
    "127dee48997e4a4f",
    "127ffd2c9b641161",
    "12847ed86ea3fced",
    "1286c2fb89116b12",
    "1286c30b34fb2592",
    "12b211d748597fdd",
    "12b641d157dbb5a9",
    "12b641db66b06d5f",
    "12b641de33d797f7",
    "12b75fd98b061f07",
    "12c2f9a74efc34ea",
    "12c822d21850a78a",
    "12cbfbec80283689",
    "12cc9ea930e8176e",
    "12deac43299cede7",
    "12e13928855273ac",
    "12fa3d6cb52bb1fe",
    "1308f784b0b82f7f",
    "132601d6bde22b0e",
    "133c7dd1b90ac939",
    "133c7f95a54c3a6c",
    "138a1a419161e5bc",
    "13cfd81c3d84865f",
    "140eebc7bf1ff538",
    "14298418b286892c",
    "14475c369d735afa",
    "14a44a594613a1a3",
    "14bdc526a684d68d",
    "14ca528cae406275",
    "14cb5053cc9814ed",
    "14d266475dbdabea",
    "14d68d090827ab02",
    "14e7dcfa5f3ae4e3",
    "150e4cea4c61ae48",
    "15127267dd509854",
    "1520f57076935ee1",
    "153e7a59f7b747f6",
    "1541054994af26af",
    "15761cae229b5bd6",
    "15ee4dc54905850a",
    "162e741bef10f87a",
    "164aa5c3db88fe04",
    "16ac23198b6779b1",
  ];

  threadsToProcess = "14475c369d735afa";

  threadsToProcess = [
    "1323faca64b1922a",
    "1278911141d958e1",
    "1254b548fd991c05",
  ];

  for (const threadId of new Set([].concat(threadsToProcess))) {
    logger.debug(`Staring processing for threadId=${threadId}`);
    await _fetchParseAndSync(threadId);
  }
}

async function _doWork8() {
  const zipFileName = "./attachments/1308f784b0b82f7f.PE.zip";
  // const zipFileName = './attachments/1541054c365ec85c.Archive.zip';
  // const zipFileName = "./attachments/12c2f9a74efc34ea.SyLe.zip";
  console.log(zipFileName);
  const allFiles = await _unzip(zipFileName);
  console.log(JSON.stringify(allFiles, null, 2));

  function _unzip(zipFileName) {
    return new Promise((resolve, reject) => {
      const zip = new StreamZip({
        file: zipFileName,
        storeEntries: true,
      });
      zip.on("error", reject);
      zip.on("ready", () => {
        const extractedDir = `${zipFileName}_extracted`;
        try {
          fs.mkdirSync(extractedDir);
        } catch (err) {}
        zip.extract(null, extractedDir, (err, count) => {
          if (err) {
            reject(err);
          } else {
            console.debug(
              `Extracted file=${zipFileName} out=${extractedDir} count=${count}`
            );
            try {
              const allFiles = _getAllFiles(extractedDir).filter((fileName) => {
                return !fileName.includes(".git/");
              });
              resolve(
                allFiles.map((file) => {
                  return {
                    name: file,
                    mimetype: mimeTypes.lookup(path.extname(file)),
                  };
                })
              );
            } catch (err) {
              reject(err);
            }
          }
          zip.close();
        });
      });
    });
  }

  function _getAllFiles(dirPath, arrayOfFiles = []) {
    fs.readdirSync(dirPath).forEach(function (file) {
      if (fs.statSync(dirPath + "/" + file).isDirectory()) {
        arrayOfFiles = _getAllFiles(dirPath + "/" + file, arrayOfFiles);
      } else {
        arrayOfFiles.push(path.join(__dirname, dirPath, "/", file));
      }
    });
    return arrayOfFiles;
  }
}

async function _start() {
  await _init();

  // await _doWork2();
  // await _doWork0();
  // await _doWork6();
  // await _doWork3();
  // await _doWork4();
  await _doWork7();
  //await _doWork8();
  process.exit();
}

_start();
