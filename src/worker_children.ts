// @ts-nocheck
import { isMainThread } from 'worker_threads';
import { workerData } from 'worker_threads';
import { parentPort } from 'worker_threads';

import { logger, initLogger } from './loggers';
initLogger(`Child.${workerData.myThreadName}.${workerData.myThreadId}`);
require('dotenv').config();

import initDatabase from './models/modelsFactory';

import * as googleApiUtils from './crawler/googleApiUtils';
import * as gmailCrawler from './crawler/gmailCrawler';
import * as gdriveCrawler from './crawler/gdriveCrawler';

import { WORK_ACTION_ENUM } from './crawler/appConstantsEnums';
import { WorkActionRequest } from './types';

if (isMainThread) {
  throw new Error('Its not a worker');
}

async function _init() {
  await initDatabase();
  await googleApiUtils.initGoogleApi();

  parentPort.on('message', async (data: WorkActionRequest) => {
    try {
      let extra = '';
      switch (data.action) {
        case WORK_ACTION_ENUM.FETCH_RAW_CONTENT:
          if (!data.id) {
            throw `${data.action} requires threadId found threadId=${data.id}`;
          }
          extra = await gmailCrawler.fetchRawContentsByThreadId(data.id);
          parentPort.postMessage({
            success: true,
            extra,
            ...data,
          });
          break;
        case WORK_ACTION_ENUM.PARSE_EMAIL:
          if (!data.id) {
            throw `${data.action} requires threadId found threadId=${data.id}`;
          }
          extra = await gmailCrawler.processMessagesByThreadId(data.id);
          parentPort.postMessage({
            success: true,
            extra,
            ...data,
          });
          break;
        case WORK_ACTION_ENUM.UPLOAD_EMAILS_BY_MESSAGE_ID:
          if (!data.id) {
            throw `${data.action} requires threadId found messageId=${data.id}`;
          }
          extra = await gdriveCrawler.uploadEmailMsgToGoogleDrive(data.id);
          parentPort.postMessage({
            success: true,
            extra,
            ...data,
          });
          break;
        case WORK_ACTION_ENUM.UPLOAD_LOGS:
          extra = await gdriveCrawler.uploadLogsToDrive();
          parentPort.postMessage({
            success: true,
            extra,
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

  console.debug('Worker started', workerData);
}

_init();
