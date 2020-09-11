// @ts-nocheck
// adapter for sql
import { Op } from "sequelize";

import { Email, GmailMessageResponse } from "../types";

import Models from "../models/modelsSchema";

import {
  REDIS_KEY,
  THREAD_JOB_STATUS_ENUM,
  WORK_ACTION_ENUM,
} from "./appConstantsEnums";

import Redis from "ioredis";

const redisInstance = new Redis({
  connectTimeout: 900000,
  maxRetriesPerRequest: 100,
  reconnectOnError(err) {
    return true;
  },
});

export async function restartAllWork() {
  let res;
  const pipeline = redisInstance.pipeline();

  const previousSuccessMessageId = [
    ...(await redisInstance.smembers(
      REDIS_KEY.QUEUE_SUCCESS_UPLOAD_MESSAGE_ID
    )),
    ...(await redisInstance.smembers(
      REDIS_KEY.QUEUE_ERROR_FETCH_AND_PARSE_THREAD_ID
    )),
  ];

  // delete all the queue
  console.debug("Start Cleaning Up Redis");
  await redisInstance.del(REDIS_KEY.ALL_MESSAGE_IDS);
  await redisInstance.del(REDIS_KEY.ALL_THREAD_IDS);
  await redisInstance.del(REDIS_KEY.QUEUE_FETCH_RAW_CONTENT);
  await redisInstance.del(REDIS_KEY.QUEUE_PARSE_EMAIL);
  await redisInstance.del(REDIS_KEY.QUEUE_UPLOAD_EMAILS_BY_MESSAGE_ID);
  await redisInstance.del(REDIS_KEY.QUEUE_SKIPPED_MESSAGE_ID);
  await redisInstance.del(REDIS_KEY.QUEUE_ERROR_UPLOAD_MESSAGE_ID);
  await redisInstance.del(REDIS_KEY.QUEUE_ERROR_FETCH_AND_PARSE_THREAD_ID);
  await redisInstance.del(REDIS_KEY.QUEUE_SUCCESS_FETCH_AND_PARSE_THREAD_ID);
  await redisInstance.del(REDIS_KEY.QUEUE_SUCCESS_UPLOAD_MESSAGE_ID);
  console.debug("Done Cleaning Up Redis");

  // move all the thread id into the allThreadIds set
  console.debug(
    "Start Cloning all threadIds into REDIS",
    REDIS_KEY.ALL_THREAD_IDS
  );
  res = await Models.Thread.getAll({
    attributes: ["threadId"],
    raw: true,
  });
  const allThreadIds = res.map((thread) => thread.threadId);
  try {
    for (const threadId of allThreadIds) {
      pipeline.sadd(REDIS_KEY.ALL_THREAD_IDS, threadId);
      pipeline.sadd(REDIS_KEY.QUEUE_FETCH_RAW_CONTENT, threadId); // no need to change this
    }
    await pipeline.exec();
  } catch (err) {}
  console.debug(
    "Done Cloning all threadIds into REDIS",
    REDIS_KEY.ALL_THREAD_IDS
  );

  // clone previous success message id
  try {
    for (const messageId of previousSuccessMessageId) {
      pipeline.sadd(REDIS_KEY.QUEUE_UPLOAD_EMAILS_BY_MESSAGE_ID, messageId); // no need to change this
    }
    await pipeline.exec();
  } catch (err) {}
  console.debug(
    "Done Cloning all previous success messageId into REDIS",
    previousSuccessMessageId.length,
    REDIS_KEY.QUEUE_UPLOAD_EMAILS_BY_MESSAGE_ID
  );
}

// attachments
export async function getAttachmentsByMessageId(messageId) {
  return Models.Attachment.getAll({
    where: {
      messageId,
      inline: {
        [Op.eq]: 0, // only use attachments from non-inline attachments
      },
    },
    raw: true,
  });
}

export async function getAttachmentsByThreadId(threadId) {
  return Models.Attachment.getAll({
    where: {
      threadId,
      size: {
        [Op.gt]: 0,
      },
    },
    raw: true,
  });
}

export async function bulkUpsertAttachments(attachments) {
  return Models.Attachment.bulkUpsert(attachments);
}

// emails
export async function getEmailsByThreadId(threadId): Email[] {
  return await Models.Email.getAll({
    attributes: [
      "id",
      "threadId",
      "driveFileId",
      "from",
      "to",
      "bcc",
      "subject",
      "rawSubject",
      "body",
      "rawBody",
      "date",
      "labelIds",
      "isEmailSentByMe",
      "isChat",
      "isEmail",
      "starred",
    ],
    where: {
      threadId,
    },
    order: ["date"],
    raw: true,
  });
}

export async function getEmailByMessageId(messageId): Email {
  return Models.Email.getOne({
    where: {
      id: messageId,
    },
    raw: true,
  });
}

// raw content
export async function getRawContentsByThreadId(
  threadId
): Promise<GmailMessageResponse[]> {
  const res = await Models.Email.getAll({
    attributes: ["rawApiResponse"],
    where: {
      threadId,
    },
    raw: true,
  });
  return res.map((message) => JSON.parse(message.rawApiResponse));
}

export async function bulkUpsertEmails(emails: Email[]) {
  await Models.Email.bulkUpsert(emails);

  // upsert the status in the redis
  for (const email of [].concat(emails)) {
    const id = email.id;
    const status = email.status;

    const pipeline = redisInstance.pipeline();

    pipeline.sadd(REDIS_KEY.ALL_MESSAGE_IDS, id);

    if (status) {
      pipeline.srem(REDIS_KEY.QUEUE_UPLOAD_EMAILS_BY_MESSAGE_ID, id);
      pipeline.srem(REDIS_KEY.QUEUE_SKIPPED_MESSAGE_ID, id);
      pipeline.srem(REDIS_KEY.QUEUE_ERROR_UPLOAD_MESSAGE_ID, id);
      pipeline.srem(REDIS_KEY.QUEUE_SUCCESS_UPLOAD_MESSAGE_ID, id);

      switch (status) {
        case THREAD_JOB_STATUS_ENUM.PENDING_SYNC_TO_GDRIVE:
          pipeline.sadd(REDIS_KEY.QUEUE_UPLOAD_EMAILS_BY_MESSAGE_ID, id);
          break;
        case THREAD_JOB_STATUS_ENUM.SKIPPED:
          pipeline.sadd(REDIS_KEY.QUEUE_SKIPPED_MESSAGE_ID, id);
          break;
        case THREAD_JOB_STATUS_ENUM.ERROR_GENERIC:
          pipeline.sadd(REDIS_KEY.QUEUE_ERROR_UPLOAD_MESSAGE_ID, id);
          break;
        case THREAD_JOB_STATUS_ENUM.SUCCESS:
          pipeline.sadd(REDIS_KEY.QUEUE_SUCCESS_UPLOAD_MESSAGE_ID, id);
          break;
      }

      await pipeline.exec();
    }
  }
}

// step 1 fetch raw content
export async function getAllThreadIdsToFetchRawContents() {
  // use redis
  const ids = await redisInstance.smembers(REDIS_KEY.QUEUE_FETCH_RAW_CONTENT);
  const pipeline = redisInstance.pipeline();
  for (let id of ids) {
    pipeline.srem(REDIS_KEY.QUEUE_FETCH_RAW_CONTENT, id);
  }
  await pipeline.exec();
  return ids;
}

// step 2 parse email
export async function getAllThreadIdsToParseEmails() {
  // use redis
  const ids = await redisInstance.smembers(REDIS_KEY.QUEUE_PARSE_EMAIL);
  const pipeline = redisInstance.pipeline();
  for (let id of ids) {
    pipeline.srem(REDIS_KEY.QUEUE_PARSE_EMAIL, id);
  }
  await pipeline.exec();
  return ids;
}

// step 3 sync / upload to gdrive
export async function getAllMessageIdsToSyncWithGoogleDrive(): String[] {
  // use redis
  const ids = await redisInstance.smembers(
    REDIS_KEY.QUEUE_UPLOAD_EMAILS_BY_MESSAGE_ID
  );
  const pipeline = redisInstance.pipeline();
  for (let id of ids) {
    pipeline.srem(REDIS_KEY.QUEUE_UPLOAD_EMAILS_BY_MESSAGE_ID, id);
  }
  await pipeline.exec();

  return ids;
}

export async function bulkUpsertThreadJobStatuses(threads) {
  // upsert record in the database
  await Models.Thread.bulkUpsert(threads, [
    "duration",
    "processedDate",
    "totalMessages",
    "historyId",
    "snippet",
  ]);

  // upsert the status in the redis
  const pipeline = redisInstance.pipeline();
  for (const thread of [].concat(threads)) {
    const id = thread.threadId;
    const status = thread.status;

    pipeline.sadd(REDIS_KEY.ALL_THREAD_IDS, id);

    if (status) {
      pipeline.srem(REDIS_KEY.QUEUE_FETCH_RAW_CONTENT, id);
      pipeline.srem(REDIS_KEY.QUEUE_PARSE_EMAIL, id);
      pipeline.srem(REDIS_KEY.QUEUE_SUCCESS_FETCH_AND_PARSE_THREAD_ID, id);
      pipeline.srem(REDIS_KEY.QUEUE_ERROR_FETCH_AND_PARSE_THREAD_ID, id);

      switch (status) {
        case THREAD_JOB_STATUS_ENUM.PENDING_CRAWL:
          pipeline.sadd(REDIS_KEY.QUEUE_FETCH_RAW_CONTENT, id);
          break;
        case THREAD_JOB_STATUS_ENUM.PENDING_PARSE_EMAIL:
          pipeline.sadd(REDIS_KEY.QUEUE_PARSE_EMAIL, id);
          break;
        case THREAD_JOB_STATUS_ENUM.SUCCESS:
          pipeline.sadd(REDIS_KEY.QUEUE_SUCCESS_FETCH_AND_PARSE_THREAD_ID, id);
          break;
        case THREAD_JOB_STATUS_ENUM.ERROR_CRAWL:
        case THREAD_JOB_STATUS_ENUM.ERROR_TIMEOUT:
          pipeline.sadd(REDIS_KEY.QUEUE_ERROR_FETCH_AND_PARSE_THREAD_ID, id);
          break;
      }
    }
  }

  await pipeline.exec();
}

export async function recoverInProgressThreadJobStatus(oldStatus, newStatus) {
  // TODO: implement me
  // const promiseThread = Models.Thread.update(
  //   {
  //     status: THREAD_JOB_STATUS_ENUM.PENDING_CRAWL,
  //     duration: null,
  //     totalMessages: null,
  //   },
  //   {
  //     where: {
  //       status: THREAD_JOB_STATUS_ENUM.IN_PROGRESS,
  //     },
  //   }
  // );
  // const promiseEmail = Models.Email.update(
  //   {
  //     status: THREAD_JOB_STATUS_ENUM.PENDING_PARSE_EMAIL,
  //   },
  //   {
  //     where: {
  //       status: THREAD_JOB_STATUS_ENUM.IN_PROGRESS,
  //     },
  //   }
  // );
  // await Promise.all([promiseThread, promiseEmail]);
}

export async function bulkUpsertFolders(folders) {
  const pipeline = redisInstance.pipeline();
  for (let folder of [].concat(folders)) {
    if (folder.driveFileId) {
      pipeline.incr(`FOLDER_USAGE_COUNT.${folder.folderName}`);
    }
  }
  await pipeline.exec();

  return Models.Folder.bulkUpsert(folders);
}

export async function getAllParentFolders() {
  const res = await Models.Folder.getAll({
    attributes: ["folderName"],
    raw: true,
    order: ["folderName"],
    where: {
      driveFileId: {
        [Op.ne]: null,
      },
    },
  });
  return res.map((folder) => folder.folderName);
}
