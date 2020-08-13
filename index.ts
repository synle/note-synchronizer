// @ts-nocheck
require("dotenv").config();

import initDatabase from "./src/modelsFactory";

import gmailCrawler from "./src/gmailCrawler";


async function _doWork(){
  await initDatabase();
  gmailCrawler();
}

_doWork();
