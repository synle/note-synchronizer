// @ts-nocheck
require("dotenv").config();

import initDatabase from "./src/models/modelsFactory";

import { initGoogleApi } from "./src/crawler/gmailCrawler";

import { doWorkForAllItems, doWorkSingle } from "./src/crawler/gdriveCrawler";

async function _doWork() {
  await initDatabase();
  await initGoogleApi();

  const targetThreadIds = (process.argv[2] || "")
    .split(",")
    .map((r) => (r || "").trim())
    .filter((r) => !!r);
  if (targetThreadIds.length > 0) {
    for (let targetThreadId of targetThreadIds) {
      await doWorkSingle(targetThreadId);
    }
  } else {
    doWorkForAllItems();
  }
}

_doWork();
