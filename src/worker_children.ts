// @ts-nocheck
require("dotenv").config();
import { isMainThread } from "worker_threads";
import { workerData } from "worker_threads";
import { parentPort } from "worker_threads";

import initDatabase from "./models/modelsFactory";

import { initGoogleApi } from "./crawler/googleApiUtils";

import {
  fetchRawContentsByThreadId,
  processMessagesByThreadId,
} from "./crawler/gmailCrawler";

import {
  uploadLogsToDrive,
  uploadEmailThreadToGoogleDrive,
} from "./crawler/gdriveCrawler";

import {
  WORKER_STATUS_ENUM,
  WORK_ACTION_ENUM,
  workAction,
} from "./crawler/commonUtils";

import { logger } from "./loggers";
import { threadId } from "worker_threads";

if (isMainThread) {
  throw new Error("Its not a worker");
}

async function _init() {
  await initDatabase();
  await initGoogleApi();

  parentPort.on("message", async (data: workAction) => {
    try {
      switch (data.action) {
        case WORK_ACTION_ENUM.FETCH_RAW_CONTENT:
          if (!data.threadId) {
            throw `${data.action} requires threadId found ${data.threadId}`;
          }
          await fetchRawContentsByThreadId(data.threadId);
          parentPort.postMessage({
            success: true,
            ...data,
          });
          break;
        case WORK_ACTION_ENUM.PARSE_EMAIL:
          if (!data.threadId) {
            throw `${data.action} requires threadId found ${data.threadId}`;
          }
          await processMessagesByThreadId(data.threadId);
          parentPort.postMessage({
            success: true,
            ...data,
          });
          break;
        case WORK_ACTION_ENUM.UPLOAD_EMAIL:
          if (!data.threadId) {
            throw `${data.action} requires threadId found ${data.threadId}`;
          }
          await uploadEmailThreadToGoogleDrive(data.threadId);
          parentPort.postMessage({
            success: true,
            ...data,
          });
          break;
        case WORK_ACTION_ENUM.UPLOAD_LOGS:
          await uploadLogsToDrive();
          parentPort.postMessage({
            success: true,
            ...data,
          });
          break;
      }
    } catch (err) {
      parentPort.postMessage({
        success: false,
        error: err.stack || err,
        ...data,
      });
    }
  });

  console.debug("Worker started:", workerData);
}

_init();
