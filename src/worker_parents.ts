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

    case WORK_ACTION_ENUM.FETCH_RAW_CONTENT:
      threadToSpawn = Math.min(maxThreadCount, 12);
      while (threadToSpawn > 0) {
        threadToSpawn--;
        const myThreadId = workers.length;
        workers.push(_newWorker(myThreadId, action, workers));
      }

      // get a list of threads to start workin g
      remainingWorkInputs = await DataUtils.getAllThreadIdsToFetchRawContents();
      intervalWorkSchedule = setInterval(_enqueueWorkWithRemainingInputs, 500); // every 10 sec
      _enqueueWorkWithRemainingInputs();
      break;

    // job 2
    case WORK_ACTION_ENUM.FETCH_EMAIL:
      threadToSpawn = Math.min(maxThreadCount, 3);
      while (threadToSpawn > 0) {
        threadToSpawn--;
        const myThreadId = workers.length;
        workers.push(_newWorker(myThreadId, action, workers));
      }

      // reprocess any in progress tasks
      await DataUtils.recoverInProgressThreadJobStatus();

      // get a list of threads to start workin g
      remainingWorkInputs = await DataUtils.getAllThreadIdsToParseEmails();
      intervalWorkSchedule = setInterval(_enqueueWorkWithRemainingInputs, 500); // every 10 sec
      _enqueueWorkWithRemainingInputs();
      break;

    // job 3
    case WORK_ACTION_ENUM.UPLOAD_EMAIL:
      threadToSpawn = Math.min(maxThreadCount, 3);
      while (threadToSpawn > 0) {
        threadToSpawn--;
        const myThreadId = workers.length;
        workers.push(_newWorker(myThreadId, action, workers));
      }

      // reprocess any in progress tasks
      await DataUtils.recoverInProgressThreadJobStatus();

      // get a list of threads to start workin g
      remainingWorkInputs = await DataUtils.getAllThreadIdsToSyncWithGoogleDrive();
      intervalWorkSchedule = setInterval(_enqueueWorkWithRemainingInputs, 500); // every 3 sec
      _enqueueWorkWithRemainingInputs();
      break;

    // job 4
    case WORK_ACTION_ENUM.UPLOAD_LOGS:
      workers.push(new _newWorker(0, action, workers));
      _enqueueWorkWithoutInput();
      intervalWorkSchedule = setInterval(
        _enqueueWorkWithoutInput,
        20 * 60 * 1000
      ); // every 20 mins
      break;
  }
}

async function _enqueueWorkWithoutInput() {
  for (let worker of workers) {
    if (worker.status === WORKER_STATUS_ENUM.FREE) {
      worker.status = WORKER_STATUS_ENUM.BUSY;
      worker.work.postMessage({
        action,
      });
    }
  }
}

async function _enqueueWorkWithRemainingInputs() {
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
          `Progress of ${action}: ${percentDone}% (${lastWorkIdx} / ${countTotalEmailThreads})`
        );
      }
    }
  }
}

_init();
