// @ts-nocheck
require("dotenv").config();
import path from "path";
import { Worker, threadId } from "worker_threads";

import initDatabase from "./models/modelsFactory";

import { initGoogleApi } from "./crawler/googleApiUtils";

import { pollForNewThreadList } from "./crawler/gmailCrawler";

import * as DataUtils from "./crawler/dataUtils";

import { logger } from "./loggers";

import {
  WORKER_STATUS_ENUM,
  WORK_ACTION_ENUM,
  maxThreadCount,
  THREAD_JOB_STATUS_ENUM,
  WorkActionRequest,
  WorkActionResponse,
} from "./crawler/commonUtils";

// workers
const workers = [];

// work related
let intervalWorkSchedule;
let lastWorkIdx, remainingWorkInputs;
let getNewWorkFunc = () => {};
const WORKER_REFRESH_INTERVAL = 1000;

const action = process.argv[2] || "";
const targetThreadIds = (process.argv[3] || "")
  .split(",")
  .map((r) => (r || "").trim())
  .filter((r) => !!r);

process.title = `Node Note-Sync ${action}`;

function _newWorker(myThreadId, myThreadName, workerGroup) {
  const worker = new Worker(path.join(__dirname, "worker_children.js"), {
    workerData: {
      myThreadId,
      myThreadName,
    },
  });
  worker.on("message", (data: WorkActionResponse) => {
    if (data.success) {
      console.debug("Worker Thread Done", myThreadName, data.id);
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

function _setupWorkers(threadToSpawn) {
  threadToSpawn = Math.min(maxThreadCount, 8);
  while (threadToSpawn > 0) {
    threadToSpawn--;
    const myThreadId = workers.length;
    workers.push(_newWorker(myThreadId, action, workers));
  }
}

async function _init() {
  logger.debug(`Starting work: command=${action} maxWorkers=${maxThreadCount}`);

  await initGoogleApi();
  await initDatabase();

  let threadToSpawn;

  switch (action) {
    default:
      logger.debug(`Aborted invalid action`);
      process.exit();
      break;

    // job1
    case WORK_ACTION_ENUM.FETCH_THREADS:
      await pollForNewThreadList(true);
      setInterval(() => pollForNewThreadList(true), 1.5 * 60 * 60 * 1000);
      break;

    // job2
    case WORK_ACTION_ENUM.FETCH_RAW_CONTENT:
      await _setupWorkers(Math.min(maxThreadCount, process.env.MAX_THREADS_FETCH_RAW_CONTENT || 6));

      // get a list of threads to start working
      getNewWorkFunc = DataUtils.getAllThreadIdsToFetchRawContents;
      await _enqueueWorkWithRemainingInputs();
      break;

    // job3
    case WORK_ACTION_ENUM.PARSE_EMAIL:
      await _setupWorkers(Math.min(maxThreadCount, process.env.MAX_THREADS_PARSE_EMAIL || 6));

      // reprocess any in progress tasks
      await DataUtils.recoverInProgressThreadJobStatus();

      // get a list of threads to start working
      getNewWorkFunc = DataUtils.getAllThreadIdsToParseEmails;
      await _enqueueWorkWithRemainingInputs();
      break;

    // job4
    case WORK_ACTION_ENUM.UPLOAD_EMAILS_BY_MESSAGE_ID:
      await _setupWorkers(Math.min(maxThreadCount, process.env.MAX_THREADS_UPLOAD_EMAILS_BY_MESSAGE_ID || 6));

      // get a list of threads to start working
      getNewWorkFunc = DataUtils.getAllMessageIdsToSyncWithGoogleDrive;
      await _enqueueWorkWithRemainingInputs();
      break;

    // job5
    case WORK_ACTION_ENUM.UPLOAD_LOGS:
      await _setupWorkers(1);

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
  remainingWorkInputs = remainingWorkInputs || [];

  if (remainingWorkInputs.length === 0) {
    logger.debug(
      `Finding work to do command=${action} workers=${workers.length}`
    );
    clearInterval(intervalWorkSchedule);
    remainingWorkInputs = await getNewWorkFunc();
    lastWorkIdx = 0;
    intervalWorkSchedule = setInterval(
      _enqueueWorkWithRemainingInputs,
      WORKER_REFRESH_INTERVAL
    );
  } else if (
    lastWorkIdx < remainingWorkInputs.length &&
    remainingWorkInputs.length > 0
  ) {
    let shouldPostUpdates = false;

    for (let worker of workers) {
      if (worker.status === WORKER_STATUS_ENUM.FREE) {
        // take task
        shouldPostUpdates = true;

        const id = remainingWorkInputs[lastWorkIdx];
        const workActionRequest: WorkActionRequest = {
          id,
          action,
        };
        worker.status = WORKER_STATUS_ENUM.BUSY;
        worker.work.postMessage(workActionRequest);
        lastWorkIdx++;
      }

      if (lastWorkIdx >= remainingWorkInputs.length) {
        // refresh task list and do again
        logger.debug(
          `Done work: command=${action} workers=${maxThreadCount} totalWork=${remainingWorkInputs.length}. Restarting with new work`
        );

        remainingWorkInputs = []; // note that this will trigger fetching new work
        lastWorkIdx = 0;
        break;
      }
    }

    if (shouldPostUpdates) {
      const countTotalEmailThreads = remainingWorkInputs.length;
      const percentDone = (
        (lastWorkIdx / countTotalEmailThreads) *
        100
      ).toFixed(2);

      if (
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
