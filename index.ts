// @ts-nocheck
require("dotenv").config();

import initDatabase from "./src/models/modelsFactory";

import gmailCrawler from "./src/crawler/gmailCrawler";

async function _doWork() {
  await initDatabase();
  gmailCrawler();
}

_doWork();
