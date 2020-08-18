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
  getThreadIdsToProcess,
} from "./crawler/gmailCrawler";

import {
  doGdriveWorkForAllItems,
  doGdriveWorkByThreadIds,
} from "./crawler/gdriveCrawler";

import { logger } from "./loggers";

const workers = [];
let maxThreadCount = 0;

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
  await initGoogleApi();
  await initDatabase();

  while (maxThreadCount > 0) {
    maxThreadCount--;
    const myThreadId = workers.length;
    workers.push(_newWorker(myThreadId));
  }

  // get a list of threads to start working
  const threadIds = getThreadIdsToProcess();
  let lastWorkIdx = 0;

  console.log(
    `parent started with ${threadIds.length} to process, firstID=${threadIds[0]}`
  );

  // requeue every 5 seconds
  let intervalWork = setInterval(() => {
    for (let worker of workers) {
      if (worker.status === WORKER_STATUS.FREE) {
        worker.status = WORKER_STATUS.BUSY;
        worker.work.postMessage(threadIds[lastWorkIdx]);
        lastWorkIdx++;
      }

      if (lastWorkIdx >= threadIds.length) {
        clearInterval(intervalWork);
        break;
      }
    }
  }, 1000);
}

_init();
