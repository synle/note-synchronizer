// @ts-nocheck
import { logger, initLogger } from "./loggers";
initLogger(Date.now());
require("dotenv").config();
import path from "path";
import { Worker } from "worker_threads";
import initDatabase from "./models/modelsFactory";
import * as googleApiUtils from "./crawler/googleApiUtils";
import * as gmailCrawler from "./crawler/gmailCrawler";
import * as DataUtils from "./crawler/dataUtils";

import {
  WORKER_REFRESH_INTERVAL,
  WORKER_STATUS_ENUM,
  WORK_ACTION_ENUM,
} from "./crawler/appConstantsEnums";
import { WorkActionRequest, WorkActionResponse } from "./types";

// workers
const workers = [];

// work related
let numThreadsToSpawn = 1;
let timerWorkSchedule;
let lastWorkIdx, remainingWorkInputs;
let getNewWorkFunc = () => {};

const action = process.argv[2] || "";

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

function _setupWorkers(inputThreadToSpawn) {
  numThreadsToSpawn = Math.min(inputThreadToSpawn, 40);

  logger.debug(
    `Starting work: command=${action} maxWorkers=${numThreadsToSpawn}`
  );

  while (numThreadsToSpawn > 0) {
    numThreadsToSpawn--;
    const myThreadId = workers.length;
    workers.push(_newWorker(myThreadId, action, workers));
  }
}

async function _init() {
  await googleApiUtils.initGoogleApi();
  await initDatabase();

  switch (action) {
    default:
      logger.debug(`Aborted invalid action`);
      process.exit();
      break;

    // job0
    case WORK_ACTION_ENUM.GENERATE_CONTAINER_FOLDERS:
      await googleApiUtils.createNoteDestinationFolder();
      break;

    // job1
    case WORK_ACTION_ENUM.FETCH_THREADS:
      await gmailCrawler.pollForNewThreadList(true);
      setInterval(
        () => gmailCrawler.pollForNewThreadList(true),
        1.5 * 60 * 60 * 1000
      );
      break;

    // job2
    case WORK_ACTION_ENUM.FETCH_RAW_CONTENT:
      await _setupWorkers(process.env.MAX_THREADS_FETCH_RAW_CONTENT || 6);
      getNewWorkFunc = DataUtils.getAllThreadIdsToFetchRawContents;
      await _enqueueWorkWithRemainingInputs();
      break;

    // job3
    case WORK_ACTION_ENUM.PARSE_EMAIL:
      await _setupWorkers(process.env.MAX_THREADS_PARSE_EMAIL || 6);
      await DataUtils.recoverInProgressThreadJobStatus();
      getNewWorkFunc = DataUtils.getAllThreadIdsToParseEmails;
      await _enqueueWorkWithRemainingInputs();
      break;

    // job4
    case WORK_ACTION_ENUM.UPLOAD_EMAILS_BY_MESSAGE_ID:
      await _setupWorkers(
        process.env.MAX_THREADS_UPLOAD_EMAILS_BY_MESSAGE_ID || 6
      );
      getNewWorkFunc = DataUtils.getAllMessageIdsToSyncWithGoogleDrive;
      await _enqueueWorkWithRemainingInputs();
      break;

    // job5
    case WORK_ACTION_ENUM.UPLOAD_LOGS:
      await _setupWorkers(1);

      _enqueueWorkWithoutInput();
      setInterval(_enqueueWorkWithoutInput, 20 * 60 * 1000); // every 20 mins
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
    // logger.debug(
    //   `Finding work to do command=${action} workers=${workers.length}`
    // );
    clearTimeout(timerWorkSchedule);
    remainingWorkInputs = await getNewWorkFunc();
    lastWorkIdx = 0;
  } else if (
    lastWorkIdx < remainingWorkInputs.length &&
    remainingWorkInputs.length > 0
  ) {
    // logger.debug(
    //   `Distribute works command=${action} workers=${workers.length}`
    // );

    for (let worker of workers) {
      if (worker.status === WORKER_STATUS_ENUM.FREE) {
        // distribute new tasks
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
          `Done work: command=${action} workers=${numThreadsToSpawn} totalWork=${remainingWorkInputs.length}. Restarting with new work`
        );

        remainingWorkInputs = []; // note that this will trigger fetching new work
        lastWorkIdx = 0;
        break;
      }
    }
  }

  // restart ping
  timerWorkSchedule = setTimeout(
    _enqueueWorkWithRemainingInputs,
    WORKER_REFRESH_INTERVAL
  );
}

_init();
