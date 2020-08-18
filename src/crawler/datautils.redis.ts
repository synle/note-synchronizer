// @ts-nocheck
// adapter for redis
import Redis from "ioredis";
import { Op } from "sequelize";

import { Email, DatabaseResponse, Attachment } from "../types";

import Models from "../models/modelsSchema";

const redis = new Redis(); // uses defaults unless given configuration object

enum REDIS_KEYS {
  ALL_THREAD_IDS = "threadIds",
}

function _makeArray(arr) {
  return [].concat(arr || []);
}

function _transformMatchedThreadsResults(matchedResults: any[]): Email[] {
  return matchedResults.map((matchedResult) => {
    const email = matchedResult.dataValues;
    email.Attachments = (email.Attachments || []).map((a) => a.dataValues);
    return email;
  });
}

// attachments
// TODO: implement me
export async function bulkUpsertAttachments(attachments) {
  return Models.Attachment.bulkCreate(_makeArray(attachments), {
    updateOnDuplicate: ["mimeType", "fileName", "path", "headers"],
  });
}

// TODO: implement me
export async function getAttachmentByThreadIds(threadId) {
  return Models.Attachment.findAll({
    where: {
      threadId,
    },
  });
}

// emails
// TODO: implement me
export async function getEmailsAndAttachmentByThreadId(threadId): Email[] {
  const matchedResults: DatabaseResponse<Email>[] = await Models.Email.findAll({
    where: {
      threadId,
    },
  });
  return _transformMatchedThreadsResults(matchedResults);
}

// TODO: implement me
export async function getAllEmailsAndAttachments(): Email[] {
  const matchedResults: DatabaseResponse<Email>[] = await Models.Email.findAll(
    {}
  );
  return _transformMatchedThreadsResults(matchedResults);
}

// TODO: implement me
export async function bulkUpsertEmails(emails) {
  return Models.Email.bulkCreate(_makeArray(emails), {
    updateOnDuplicate: [
      "from",
      "body",
      "rawBody",
      "subject",
      "rawSubject",
      "headers",
      "to",
      "bcc",
      "date",
    ],
  });
}

// threads
export async function getAllThreadsToProcess() {
  return redis.smembers(REDIS_KEYS.ALL_THREAD_IDS);
}

export async function bulkUpsertThreadJobStatuses(threads) {
  return redis.sadd(
    REDIS_KEYS.ALL_THREAD_IDS,
    _makeArray(threads).map((thread) => thread.threadId)
  );
}

// raw content
// TODO: implement me
export async function getAllRawContents() {
  return [];
}

// TODO: implement me
export async function getRawContentsByThreadId(threadId) {
  return [];
}

export async function bulkUpsertRawContents(rawContents) {
  for (let rawContent of _makeArray(rawContents)) {
    // store the list of related messageIds by threadIds
    await redis.sadd(
      `messageIdsByThreadId.${rawContent.threadId}`,
      rawContent.messageId
    );
    console.log(
      "SAVE",
      `messageIdsByThreadId.${rawContent.threadId}`,
      rawContent.messageId
    );

    // store the message by messageId
    await redis.hmset(`rawContents`, {
      [rawContent.messageId]: rawContent.rawApiResponse,
    });
  }
}

// lrange messageIdsByThreadId._threadId_ 0 -1
// hgetall rawContents _messageId1_ _mesageId2_
