// @ts-nocheck
require("dotenv").config();

import initDatabase from "./src/models/modelsFactory";

import {
  initGoogleApi
} from "./src/crawler/gmailCrawler";

import {
  doWorkForAllItems,
  doWorkSingle,
} from "./src/crawler/gdriveCrawler";

async function _doWork() {
  await initDatabase();
  await initGoogleApi();

  const targetThreadId = process.argv[2]
  if (targetThreadId){
    console.log("Starting GDrive Crawler on a single item", targetThreadId);
    doWorkSingle(targetThreadId);
  }  else{
    console.log('Starting GDrive Crawler on all items');
    doWorkForAllItems();
  }
}

_doWork();
