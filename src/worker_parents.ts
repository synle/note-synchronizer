// @ts-nocheck
require("dotenv").config();
import path from "path";
import { Worker, threadId } from "worker_threads";

import initDatabase from "./models/modelsFactory";

import { initGoogleApi } from "./crawler/googleApiUtils";

import { uploadEmailThreadToGoogleDrive } from "./crawler/gdriveCrawler";
import {
  pollForNewThreadList,
  fetchEmailsByThreadIds,
} from "./crawler/gmailCrawler";

import * as DataUtils from "./crawler/dataUtils";

import { logger } from "./loggers";

// workers
const workers = [];

// work related
let intervalWorkSchedule;
let lastWorkIdx = 0;
let remainingWorkInputs = [];

const action = process.argv[2] || "";
const targetThreadIds = (process.argv[3] || "")
  .split(",")
  .map((r) => (r || "").trim())
  .filter((r) => !!r);

import {
  WORKER_STATUS_ENUM,
  WORK_ACTION_ENUM,
  maxThreadCount,
  THREAD_JOB_STATUS,
  WorkActionResponse,
} from "./crawler/commonUtils";

function _newWorker(myThreadId, myThreadName, workerGroup) {
  const worker = new Worker(path.join(__dirname, "worker_children.js"), {
    workerData: {
      myThreadId,
      myThreadName,
    },
  });
  worker.on("message", (data: WorkActionResponse) => {
    if (data.success) {
      console.debug("Worker Thread Done", myThreadName, data.threadId);
    } else {
      console.error("Worker Thread Failed", myThreadName, data.error, data);
    }

    workerGroup[myThreadId].status = WORKER_STATUS_ENUM.FREE;
  });
  worker.on("error", (...err) => {
    // console.error("Worker Failed with error", myThreadId, error);
    setTimeout(() => {
      workerGroup[myThreadId] = _newWorker(
        myThreadId,
        myThreadName,
        workerGroup
      );
    }, 2000);
  });
  worker.on("exit", (...code) => {
    // console.error("Worker Exit with code", myThreadId, code);
    setTimeout(() => {
      workerGroup[myThreadId] = _newWorker(
        myThreadId,
        myThreadName,
        workerGroup
      );
    }, 2000);
  });

  const workerDetails = {};
  workerDetails.work = worker;
  workerDetails.status = WORKER_STATUS_ENUM.FREE;

  return workerDetails;
}

async function _init() {
  await initGoogleApi();
  await initDatabase();

  logger.debug(`Starting work: command=${action} workers=${maxThreadCount}`);

  let threadToSpawn;

  switch (action) {
    default:
      process.exit();
      break;

    // single run fetch email details
    case WORK_ACTION_ENUM.SINGLE_RUN_FETCH_EMAIL:
      await fetchEmailsByThreadIds(targetThreadIds);
      break;

    // single run upload email
    case WORK_ACTION_ENUM.SINGLE_RUN_UPLOAD_EMAIL:
      await uploadEmailThreadToGoogleDrive(targetThreadIds);
      break;

    // job 1
    case WORK_ACTION_ENUM.FETCH_THREADS:
      await pollForNewThreadList(true);
      break;

    // job 2
    case WORK_ACTION_ENUM.FETCH_EMAIL:
      threadToSpawn = maxThreadCount;
      while (threadToSpawn > 0) {
        threadToSpawn--;
        const myThreadId = workers.length;
        workers.push(_newWorker(myThreadId, action, workers));
      }

      // reprocess any in progress tasks
      await DataUtils.recoverInProgressThreadJobStatus();

      // get a list of threads to start workin g
      remainingWorkInputs = await DataUtils.getAllThreadIdsToFetchDetails();
      intervalWorkSchedule = setInterval(_enqueueWorkFetchEmails, 500); // every 10 sec
      _enqueueWorkFetchEmails();
      break;

    // job 3
    case WORK_ACTION_ENUM.UPLOAD_EMAIL:
      threadToSpawn = 3;
      while (threadToSpawn > 0) {
        threadToSpawn--;
        const myThreadId = workers.length;
        workers.push(_newWorker(myThreadId, action, workers));
      }

      // reprocess any in progress tasks
      await DataUtils.recoverInProgressThreadJobStatus();

      // get a list of threads to start workin g
      remainingWorkInputs = await DataUtils.getAllThreadIdsToSyncWithGoogleDrive();
      _enqueueUploadEmails();
      intervalWorkSchedule = setInterval(_enqueueUploadEmails, 500); // every 3 sec
      break;

    // job 4
    case WORK_ACTION_ENUM.UPLOAD_LOGS:
      workers.push(new _newWorker(0, action, workers));
      _enqueueUploadLogs();
      intervalWorkSchedule = setInterval(_enqueueUploadLogs, 20 * 60 * 1000); // every 20 mins
      break;
  }
}

async function _enqueueWorkFetchEmails() {
  if (lastWorkIdx < remainingWorkInputs.length) {
    // print progres
    const countTotalEmailThreads = remainingWorkInputs.length;
    const percentDone = ((lastWorkIdx / countTotalEmailThreads) * 100).toFixed(
      2
    );

    if (
      lastWorkIdx === 0 ||
      lastWorkIdx % 500 === 0 ||
      (percentDone % 20 === 0 && percentDone > 0)
    ) {
      logger.warn(
        `Progress of Fetching Emails: ${percentDone}% (${lastWorkIdx} / ${countTotalEmailThreads})`
      );
    }

    for (let worker of workers) {
      if (worker.status === WORKER_STATUS_ENUM.FREE) {
        // take task
        const threadId = remainingWorkInputs[lastWorkIdx];
        worker.status = WORKER_STATUS_ENUM.BUSY;
        worker.work.postMessage({
          threadId,
          action,
        });
        lastWorkIdx++;
      }

      if (lastWorkIdx >= remainingWorkInputs.length) {
        // done all work, stopped...
        clearInterval(intervalWorkSchedule);
        logger.debug("Done processing all task");
        process.exit();
      }
    }
  }
}

async function _enqueueUploadLogs() {
  for (let worker of workers) {
    if (worker.status === WORKER_STATUS_ENUM.FREE) {
      worker.status = WORKER_STATUS_ENUM.BUSY;
      worker.work.postMessage({
        action,
      });
    }
  }
}

async function _enqueueUploadEmails() {
  if (lastWorkIdx < remainingWorkInputs.length) {
    // print progres
    let shouldPostUpdates = false;

    for (let worker of workers) {
      if (worker.status === WORKER_STATUS_ENUM.FREE) {
        // take task
        shouldPostUpdates = true;

        const threadId = remainingWorkInputs[lastWorkIdx];
        worker.status = WORKER_STATUS_ENUM.BUSY;
        worker.work.postMessage({
          threadId,
          action,
        });
        lastWorkIdx++;
      }

      if (lastWorkIdx >= remainingWorkInputs.length) {
        // done all work, stopped...
        clearInterval(intervalWorkSchedule);

        // refresh task list and do again
        remainingWorkInputs = [];
        lastWorkIdx = 0;
        remainingWorkInputs = await DataUtils.getAllThreadIdsToSyncWithGoogleDrive();

        // stop
        // process.exit();
      }
    }

    if (shouldPostUpdates) {
      const countTotalEmailThreads = remainingWorkInputs.length;
      const percentDone = (
        (lastWorkIdx / countTotalEmailThreads) *
        100
      ).toFixed(2);

      if (
        remainingWorkInputs.length > 1000 ||
        lastWorkIdx === 0 ||
        lastWorkIdx % 500 === 0 ||
        (percentDone % 20 === 0 && percentDone > 0)
      ) {
        logger.warn(
          `Progress of Uploading Emails: ${percentDone}% (${lastWorkIdx} / ${countTotalEmailThreads})`
        );
      }
    }
  }
}

_init();
