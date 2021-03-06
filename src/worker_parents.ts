// @ts-nocheck
const action = process.argv[2] || '';
process.title = `Note Sync ${action}`;

import { logger, initLogger } from './loggers';
initLogger(`Parents.${action}`);
require('dotenv').config();
import path from 'path';
import { Worker } from 'worker_threads';
import initDatabase from './models/modelsFactory';
import * as googleApiUtils from './crawler/googleApiUtils';
import * as gmailCrawler from './crawler/gmailCrawler';
import * as DataUtils from './crawler/dataUtils';
import moment from 'moment';

import { WORKER_REFRESH_INTERVAL, WORKER_STATUS_ENUM, WORK_ACTION_ENUM } from './crawler/appConstantsEnums';
import { WorkActionRequest, WorkActionResponse } from './types';

// workers
const workers = [];

// work related
let numThreadsToSpawn = 1;
let timerWorkSchedule;
let lastWorkIdx, remainingWorkInputs;
let getNewWorkFunc = () => {};

process.title = `Node Note-Sync ${action}`;

function _newWorker(myThreadId, myThreadName, workerGroup) {
  const worker = new Worker(path.join(__dirname, 'worker_children.js'), {
    workerData: {
      myThreadId,
      myThreadName,
    },
  });
  worker.on('message', (data: WorkActionResponse) => {
    if (data.success) {
      if (data.extra) {
        logger.debug(`Worker Thread Done action=${data.action} extra=${data.extra} id=${data.id}`);
      } else {
        logger.debug(`Worker Thread Done action=${data.action} id=${data.id}`);
      }
    } else {
      logger.error(
        `Worker Thread Failed action=${data.action} error=${data.error.stack || data.error} data=${JSON.stringify(
          data,
        )}`,
      );
    }

    workerGroup[myThreadId].status = WORKER_STATUS_ENUM.FREE;
  });
  worker.on('error', (...err) => {
    console.debug(`Worker Died with error. Respawn myThreadName=${myThreadName} myThreadId=${myThreadId}`, error);
    setTimeout(() => {
      workerGroup[myThreadId] = _newWorker(myThreadId, myThreadName, workerGroup);
    }, 2000);
  });
  worker.on('exit', (...code) => {
    // console.error("Worker Exit with code", myThreadId, code);
    setTimeout(() => {
      workerGroup[myThreadId] = _newWorker(myThreadId, myThreadName, workerGroup);
    }, 2000);
  });

  const workerDetails = {};
  workerDetails.work = worker;
  workerDetails.status = WORKER_STATUS_ENUM.FREE;
  workerDetails.id = myThreadId;

  return workerDetails;
}

function _setupWorkers(inputThreadToSpawn) {
  numThreadsToSpawn = Math.min(inputThreadToSpawn, 200);

  logger.debug(`Starting work action=${action} maxWorkers=${numThreadsToSpawn}`);

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
      await DataUtils.restartAllWork();
      await googleApiUtils.createNoteDestinationFolder();
      process.exit();
      break;

    // job1
    case WORK_ACTION_ENUM.FETCH_THREADS:
      await gmailCrawler.pollForNewThreadList();
      setInterval(
        () =>
          gmailCrawler.pollForNewThreadList(
            moment().subtract(parseInt(process.env.POLL_DAYS_DELTA), 'days').format('YYYY/MM/DD'),
          ),
        12 * 60 * 60 * 1000,
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
      await _setupWorkers(process.env.MAX_THREADS_UPLOAD_EMAILS_BY_MESSAGE_ID || 6);
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
    clearTimeout(timerWorkSchedule);
    remainingWorkInputs = await getNewWorkFunc();
    lastWorkIdx = 0;
    if (remainingWorkInputs.length > 0) {
      logger.debug(`Found New works action=${action} totalWorks=${remainingWorkInputs.length}`);
    }
  } else if (lastWorkIdx < remainingWorkInputs.length && remainingWorkInputs.length > 0) {
    // logger.debug(
    //   `Distribute works action=${action} workers=${workers.length}`
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

        logger.debug(
          `Distribute work for action=${action} worker=${worker.id} lastWorkIdx=${lastWorkIdx} totalWorks=${remainingWorkInputs.length} id=${id}`,
        );

        worker.work.postMessage(workActionRequest);
        lastWorkIdx++;
      }

      if (lastWorkIdx >= remainingWorkInputs.length) {
        // refresh task list and do again
        logger.debug(
          `Done work: action=${action} workers=${numThreadsToSpawn} totalWork=${remainingWorkInputs.length}. Restarting with new work`,
        );

        remainingWorkInputs = []; // note that this will trigger fetching new work
        lastWorkIdx = 0;
        break;
      }
    }
  }

  // restart ping
  timerWorkSchedule = setTimeout(_enqueueWorkWithRemainingInputs, WORKER_REFRESH_INTERVAL);
}

_init();
