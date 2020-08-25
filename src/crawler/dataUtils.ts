// @ts-nocheck
// adapter for sql
import { Op } from "sequelize";

import { Email, GmailMessageResponse } from "../types";

import Models from "../models/modelsSchema";

import { THREAD_JOB_STATUS_ENUM, WORK_ACTION_ENUM } from "./commonUtils";

import Redis from "ioredis";
const redisInstance = new Redis();

enum REDIS_KEY {
  ALL_MESSAGE_IDS = 'ALL_MESSAGE_IDS',
  ALL_THREAD_IDS = 'ALL_THREAD_IDS',
  FETCH_RAW_CONTENT = 'FETCH_RAW_CONTENT',
  PARSE_EMAIL = 'PARSE_EMAIL',
  GENERATE_CONTAINER_FOLDERS = 'GENERATE_CONTAINER_FOLDERS',
  UPLOAD_EMAILS_BY_MESSAGE_ID = 'UPLOAD_EMAILS_BY_MESSAGE_ID',
}

export async function restartAllWork(){
  let res;
  const pipeline = redisInstance.pipeline();

  // delete all the queue
  console.debug("Start Cleaning Up Redis");
  await redisInstance.del(REDIS_KEY.ALL_THREAD_IDS);
  await redisInstance.del(REDIS_KEY.ALL_MESSAGE_IDS);
  await redisInstance.del(REDIS_KEY.FETCH_RAW_CONTENT);
  await redisInstance.del(REDIS_KEY.PARSE_EMAIL);
  await redisInstance.del(REDIS_KEY.GENERATE_CONTAINER_FOLDERS);
  await redisInstance.del(REDIS_KEY.UPLOAD_EMAILS_BY_MESSAGE_ID);
  console.debug("Done Cleaning Up Redis");

  // move all the thread id into the allThreadIds set
  console.debug("Start Cloning all threadIds into REDIS", REDIS_KEY.ALL_THREAD_IDS);
  res = await Models.Thread.findAll({
    attributes: ["threadId"],
    raw: true,
  });
  const allThreadIds = res.map((thread) => thread.threadId);
  try{
    for (const threadId of allThreadIds){
      pipeline.sadd(REDIS_KEY.ALL_THREAD_IDS, threadId);
      // pipeline.sadd(REDIS_KEY.FETCH_RAW_CONTENT, threadId); // no need to change this
    }
    await pipeline.exec();
  } catch(err){}
  console.debug("Done Cloning all threadIds into REDIS", REDIS_KEY.ALL_THREAD_IDS);

  // move all the message id into the allMessageIds set
  console.debug("Start Cloning all messageIds into REDIS", REDIS_KEY.ALL_MESSAGE_IDS);
  res = await Models.Email.findAll({
    attributes: ["id"],
    raw: true,
  });
  const allMessageIds = res.map((message) => message.id);
  try {
    for (const messageId of allMessageIds){
      pipeline.sadd(REDIS_KEY.ALL_MESSAGE_IDS, messageId);
      // pipeline.sadd(REDIS_KEY.PARSE_EMAIL, messageId); // no need to do this
      pipeline.sadd(REDIS_KEY.UPLOAD_EMAILS_BY_MESSAGE_ID, messageId);
    }
    await pipeline.exec();
  } catch (err) {}
  console.debug("Done Cloning all messageIds into REDIS", REDIS_KEY.ALL_MESSAGE_IDS);
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
  return Models.Email.bulkUpsert(emails);
}

// step 1 fetch raw content
export async function getAllThreadIdsToFetchRawContents() {
  const req = {
    attributes: ["threadId"], // only fetch threadId
    where: {
      status: {
        [Op.eq]: THREAD_JOB_STATUS_ENUM.PENDING_CRAWL,
      },
    },
    raw: true,
  };

  const res = await Models.Thread.findAll(req);
  return res.map((thread) => thread.threadId);
}

// step 2 parse email
export async function getAllThreadIdsToParseEmails() {
  const req = {
    attributes: ["threadId"], // only fetch threadId
    where: {
      status: {
        [Op.eq]: THREAD_JOB_STATUS_ENUM.PENDING_PARSE_EMAIL,
      },
    },
    raw: true,
  };

  const res = await Models.Thread.findAll(req);
  return res.map((thread) => thread.threadId);
}

// step 3 sync / upload to gdrive
export async function getAllMessageIdsToSyncWithGoogleDrive(): String[] {
  const res = await Models.Email.findAll({
    attributes: ["id"],
    where: {
      status: {
        [Op.eq]: THREAD_JOB_STATUS_ENUM.PENDING_SYNC_TO_GDRIVE,
      },
    },
    raw: true,
  });
  return res.map((thread) => thread.id);
}

export async function bulkUpsertThreadJobStatuses(threads) {
  return Models.Thread.bulkUpsert(threads, [
    "status",
    "processedDate",
    "totalMessages",
    "historyId",
  ]);
}

export async function recoverInProgressThreadJobStatus(oldStatus, newStatus) {
  const promiseThread = Models.Thread.update(
    {
      status: THREAD_JOB_STATUS_ENUM.PENDING_CRAWL,
      duration: null,
      totalMessages: null,
    },
    {
      where: {
        status: THREAD_JOB_STATUS_ENUM.IN_PROGRESS,
      },
    }
  );

  const promiseEmail = Models.Email.update(
    {
      status: THREAD_JOB_STATUS_ENUM.PENDING_PARSE_EMAIL,
    },
    {
      where: {
        status: THREAD_JOB_STATUS_ENUM.IN_PROGRESS,
      },
    }
  );

  await Promise.all([promiseThread, promiseEmail]);
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
