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

const redisInstance = new Redis();

export async function restartAllWork() {
  let res;
  const pipeline = redisInstance.pipeline();

  // delete all the queue
  console.debug("Start Cleaning Up Redis");
  await redisInstance.del(REDIS_KEY.ALL_THREAD_IDS);
  await redisInstance.del(REDIS_KEY.ALL_MESSAGE_IDS);
  await redisInstance.del(REDIS_KEY.QUEUE_FETCH_RAW_CONTENT);
  await redisInstance.del(REDIS_KEY.QUEUE_PARSE_EMAIL);
  await redisInstance.del(REDIS_KEY.QUEUE_UPLOAD_EMAILS_BY_MESSAGE_ID);
  await redisInstance.del(REDIS_KEY.QUEUE_SKIPPED_MESSAGE_ID);
  console.debug("Done Cleaning Up Redis");

  // move all the thread id into the allThreadIds set
  console.debug(
    "Start Cloning all threadIds into REDIS",
    REDIS_KEY.ALL_THREAD_IDS
  );
  res = await Models.Thread.findAll({
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

  // move all the message id into the allMessageIds set
  console.debug(
    "Start Cloning all messageIds into REDIS",
    REDIS_KEY.ALL_MESSAGE_IDS
  );
  res = await Models.Email.findAll({
    attributes: ["id"],
    raw: true,
  });
  const allMessageIds = res.map((message) => message.id);
  try {
    for (const messageId of allMessageIds) {
      pipeline.sadd(REDIS_KEY.ALL_MESSAGE_IDS, messageId);
      // pipeline.sadd(REDIS_KEY.PARSE_EMAIL, messageId); // no need to do this
      // pipeline.sadd(REDIS_KEY.UPLOAD_EMAILS_BY_MESSAGE_ID, messageId);
    }
    await pipeline.exec();
  } catch (err) {}
  console.debug(
    "Done Cloning all messageIds into REDIS",
    REDIS_KEY.ALL_MESSAGE_IDS
  );
}

// attachments
export async function getAttachmentByMessageId(messageId) {
  return Models.Attachment.findAll({
    where: {
      messageId,
      inline: {
        [Op.eq]: 0, // only use attachments from non-inline attachments
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
  return await Models.Email.findAll({
    attributes: [
      "id",
      "threadId",
      "from",
      "bcc",
      "to",
      "subject",
      "rawSubject",
      "body",
      "rawBody",
      "date",
      "labelIds",
    ],
    where: {
      threadId,
    },
    raw: true,
  });
}

export async function getEmailByMessageId(messageId): Email {
  const res = await Models.Email.findAll({
    attributes: [
      "id",
      "threadId",
      "from",
      "bcc",
      "to",
      "subject",
      "rawSubject",
      "body",
      "rawBody",
      "date",
      "labelIds",
    ],
    where: {
      id: messageId,
    },
    raw: true,
  });

  if (res.length === 1) {
    return res[0];
  }

  return null;
}

// raw content
export async function getRawContentsByThreadId(
  threadId
): Promise<GmailMessageResponse[]> {
  const res = await Models.Email.findAll({
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
  const pipeline = redisInstance.pipeline();
  for (const email of [].concat(emails)) {
    const id = email.id;
    const status = email.status;

    pipeline.sadd(REDIS_KEY.ALL_MESSAGE_IDS, id);

    if (status) {
      pipeline.srem(REDIS_KEY.QUEUE_UPLOAD_EMAILS_BY_MESSAGE_ID, id);
      pipeline.srem(REDIS_KEY.QUEUE_SKIPPED_MESSAGE_ID, id);
      pipeline.srem(REDIS_KEY.QUEUE_ERROR_MESSAGE_ID, id);

      switch (status) {
        case THREAD_JOB_STATUS_ENUM.PENDING_SYNC_TO_GDRIVE:
          pipeline.sadd(REDIS_KEY.QUEUE_UPLOAD_EMAILS_BY_MESSAGE_ID, id);
          break;
        case THREAD_JOB_STATUS_ENUM.SKIPPED:
          pipeline.sadd(REDIS_KEY.QUEUE_SKIPPED_MESSAGE_ID, id);
          break;
        case THREAD_JOB_STATUS_ENUM.ERROR_GENERIC:
          pipeline.sadd(REDIS_KEY.QUEUE_ERROR_MESSAGE_ID, id);
          break;
      }
    }
  }

  await pipeline.exec();
}

// step 1 fetch raw content
export async function getAllThreadIdsToFetchRawContents() {
  // use redis
  const ids = await redisInstance.smembers(REDIS_KEY.QUEUE_FETCH_RAW_CONTENT);
  const pipeline = redisInstance.pipeline();
  for (let id of ids) {
    pipeline.srem(id);
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
    pipeline.srem(id);
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
    pipeline.srem(id);
  }
  await pipeline.exec();
  return ids;
}

export async function bulkUpsertThreadJobStatuses(threads) {
  // upsert record in the database
  await Models.Thread.bulkUpsert(threads, [
    "processedDate",
    "totalMessages",
    "historyId",
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

      switch (status) {
        case THREAD_JOB_STATUS_ENUM.PENDING_CRAWL:
          pipeline.sadd(REDIS_KEY.QUEUE_FETCH_RAW_CONTENT, id);
          break;
        case THREAD_JOB_STATUS_ENUM.PENDING_PARSE_EMAIL:
          pipeline.sadd(REDIS_KEY.QUEUE_PARSE_EMAIL, id);
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
  return Models.Folder.bulkUpsert(folders);
}

export async function getAllParentFolders() {
  const res = await Models.Folder.findAll({
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
