// @ts-nocheck
require("dotenv").config();

import initDatabase from "./src/models/modelsFactory";

import {
  initGoogleApi,
  doWorkForAllItems,
  doWorkSingle,
} from "./src/crawler/gmailCrawler";

async function _doWork() {
  await initDatabase();
  await initGoogleApi();

  try {
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
  } catch (e) {
    console.log("e", e);
  }
}

_doWork();
