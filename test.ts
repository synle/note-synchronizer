// @ts-nocheck
require("dotenv").config();

globalThis.LOG_LEVEL = "debug";

import initDatabase from "./src/models/modelsFactory";

import { Op } from "sequelize";

import { initGoogleApi } from "./src/crawler/googleApiUtils";
import * as googleApiUtils from "./src/crawler/googleApiUtils";

import {
  pollForNewThreadList,
  fetchEmailsByThreadIds,
} from "./src/crawler/gmailCrawler";

import { uploadEmailThreadToGoogleDrive } from "./src/crawler/gdriveCrawler";

import Models from "./src/models/modelsSchema";
import * as DataUtils from "./src/crawler/dataUtils";

async function _init() {
  console.log("test inits");

  await initDatabase();
  await initGoogleApi();

  console.log("test starts");
}

async function _doWork1() {
  await _init();

  const res1 = await Models.Thread.findAll({
    where: {
      status: {
        [Op.eq]: "pending",
      },
    },
    order: [
      ["updatedAt", "DESC"], // start with the one that changes recenty
    ],
    limit: 1,
    raw: true,
  });

  console.log("res1");
  console.log(res1.map((thread) => thread.threadId));

  const res2 = await Models.RawContent.findAll({
    where: {
      threadId: "133bc5c901655839",
    },
    raw: true,
  });

  console.log("res2");
  console.log(res2);

  const res3 = await Models.RawContent.findAll({
    where: {
      threadId: "10f24bee68d2786e",
    },
    raw: true,
  });

  console.log("res3");
  console.log(res3.map((message) => JSON.parse(message.rawApiResponse)));
}

async function _doWork2() {
  await _init();

  const threadIds = await DataUtils.getAllThreadsToProcess();
  if (threadIds.length > 0 && threadIds[0].length > 0) {
    console.log("PASSED ThreadIds Check", threadIds.length, threadIds[0]);
  } else {
    console.error("FAILED ThreadIds Check", threadIds);
  }

  const rawContents = await DataUtils.getRawContentsByThreadId(
    "10f24bee68d2786e"
  );
  if (rawContents.length > 0 && rawContents[0].id && rawContents[0].threadId) {
    console.log(
      "PASSED rawContents Check",
      rawContents.length,
      rawContents[0].threadId,
      rawContents[0].id
    );
  } else {
    console.error(
      "FAILED rawContents Check",
      rawContents[0],
      rawContents[0].id,
      rawContents[0].threadId
    );
  }
}

async function _doWork3() {
  await _init();

  const targetThreadId = "13089ea274e32128";

  try {
    await uploadEmailThreadToGoogleDrive(targetThreadId);
  } catch (e) {
    console.log(e.stack);
  }
}

async function _doWork4() {
  await _init();

  try {
    await googleApiUtils.uploadFile(
      'test.html',
      "text/html",
      "./test.html",
      "test html file",
      new Date().getTime(),
      true
    );
  } catch (e) {
    console.log(e.stack);
  }
}

_doWork3();
