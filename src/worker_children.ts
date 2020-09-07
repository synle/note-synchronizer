// @ts-nocheck
import { logger, initLogger } from "./loggers";
initLogger(Date.now());
require("dotenv").config();
import { isMainThread } from "worker_threads";
import { workerData } from "worker_threads";
import { parentPort } from "worker_threads";

import initDatabase from "./models/modelsFactory";

import * as googleApiUtils from "./crawler/googleApiUtils";
import * as gmailCrawler from "./crawler/gmailCrawler";
import * as gdriveCrawler from "./crawler/gdriveCrawler";

import { WORK_ACTION_ENUM } from "./crawler/appConstantsEnums";
import { WorkActionRequest } from "./types";

if (isMainThread) {
  throw new Error("Its not a worker");
}

async function _init() {
  await initDatabase();
  await googleApiUtils.initGoogleApi();

  parentPort.on("message", async (data: WorkActionRequest) => {
    try {
      switch (data.action) {
        case WORK_ACTION_ENUM.FETCH_RAW_CONTENT:
          if (!data.id) {
            throw `${data.action} requires threadId found threadId=${data.id}`;
          }
          await gmailCrawler.fetchRawContentsByThreadId(data.id);
          parentPort.postMessage({
            success: true,
            ...data,
          });
          break;
        case WORK_ACTION_ENUM.PARSE_EMAIL:
          if (!data.id) {
            throw `${data.action} requires threadId found threadId=${data.id}`;
          }
          await gmailCrawler.processMessagesByThreadId(data.id);
          parentPort.postMessage({
            success: true,
            ...data,
          });
          break;
        case WORK_ACTION_ENUM.UPLOAD_EMAILS_BY_THREAD_ID:
          if (!data.id) {
            throw `${data.action} requires threadId found threadId=${data.id}`;
          }
          const docDriveFileId = await gdriveCrawler.uploadEmailThreadToGoogleDrive(data.id);

          logger.debug(
            `Link to google doc threadId=${data.id}:\nhttps://docs.google.com/document/d/${docDriveFileId}`
          );

          parentPort.postMessage({
            success: true,
            ...data,
          });
          break;
        case WORK_ACTION_ENUM.UPLOAD_LOGS:
          await gdriveCrawler.uploadLogsToDrive();
          parentPort.postMessage({
            success: true,
            ...data,
          });
          break;
      }
    } catch (err) {
      parentPort.postMessage({
        success: false,
        error: JSON.stringify(err.stack || err),
        ...data,
      });
    }
  });

  console.debug("Worker started:", workerData);
}

_init();
