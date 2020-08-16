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

  const targetThreadId = process.argv[2]
  if (targetThreadId){
    console.log("Starting Gmail Crawler on a single item", targetThreadId);
    doWorkSingle(targetThreadId);
  }  else{
    console.log('Starting Gmail Crawler on all items');
    doWorkForAllItems();
  }
}

_doWork();
