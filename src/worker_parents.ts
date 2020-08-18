// @ts-nocheck
import path from "path";
import { Worker } from "worker_threads";

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

const workers = [];
let maxThreadCount = 6;

enum WORKER_STATUS {
  FREE = "FREE",
  BUSY = "BUSY",
}

function _newWorker(myThreadId) {
  console.log("spawn", myThreadId);

  const workerDetails = {};

  const worker = new Worker(path.join(__dirname, "worker_children.js"), {
    workerData: {
      myThreadId,
    },
  });
  worker.on("message", (data) => {
    console.log("parent received message from worker", myThreadId, data);
    workers[myThreadId].status = WORKER_STATUS.FREE;
  });
  worker.on("error", (...err) => {
    // wip - respawn
    console.log("worker failed", myThreadId, error);
    workers[myThreadId] = _newWorker(myThreadId);
  });
  worker.on("exit", (...code) => {
    // wip - respawn
    console.log("worker exit", myThreadId, code);
    workers[myThreadId] = _newWorker(myThreadId);
  });

  workerDetails.work = worker;
  workerDetails.status = "FREE";

  return workerDetails;
}

async function _init() {
  while (maxThreadCount > 0) {
    maxThreadCount--;
    const myThreadId = workers.length;
    workers.push(_newWorker(myThreadId));
  }

  console.log("parent started");

  setInterval(() => {
    for (let worker of workers) {
      worker.status = WORKER_STATUS.BUSY;
      worker.work.postMessage("message from parent " + Date.now());
    }
  }, 1000);
}

_init();
