// @ts-nocheck
import { isMainThread } from "worker_threads";
import { workerData } from "worker_threads";
import { parentPort } from "worker_threads";

import initDatabase from "./models/modelsFactory";

import {
  getNoteDestinationFolderId,
  initGoogleApi,
  uploadFile,
} from "./crawler/googleApiUtils";

import {
  doGmailWorkPollThreadList,
  doGmailWorkForAllItems,
  doGmailWorkByThreadIds,
  doDecodeBase64ForRawContent,
} from "./crawler/gmailCrawler";

import {
  doGdriveWorkForAllItems,
  doGdriveWorkByThreadIds,
} from "./crawler/gdriveCrawler";

import { logger } from "./loggers";

if (isMainThread) {
  throw new Error("Its not a worker");
}

async function _init() {
  await initDatabase();
  await initGoogleApi();

  parentPort.on("message", (data: any) => {
    console.log("child message do", data);
    setTimeout(() => {
      parentPort.postMessage("hello parents: " + data);
    }, 3000);
  });

  console.log("child started", workerData);
}

_init();
