// @ts-nocheck
// adapter for sql
import { Op } from "sequelize";

import { Email, GmailMessageResponse } from "../types";

import Models from "../models/modelsSchema";

import { THREAD_JOB_STATUS_ENUM } from "./commonUtils";

function _makeArray(arr) {
  return [].concat(arr || []);
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
  attachments = _makeArray(attachments);
  return Models.Attachment.bulkCreate(attachments, {
    updateOnDuplicate: Object.keys(attachments[0]),
  });
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
  emails = _makeArray(emails);
  return Models.Email.bulkCreate(emails, {
    updateOnDuplicate: Object.keys(emails[0]),
  });
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
export async function getAllThreadIdsToParseEmails(limit = 2250) {
  const req = {
    attributes: ["threadId"], // only fetch threadId
    where: {
      status: {
        [Op.eq]: THREAD_JOB_STATUS_ENUM.PENDING_PARSE_EMAIL,
      },
    },
    raw: true,
    limit,
  };

  const res = await Models.Thread.findAll(req);
  return res.map((thread) => thread.threadId);
}

// step 3 sync / upload to gdrive
export async function getAllThreadIdsToSyncWithGoogleDrive(
  limit = 250
): String[] {
  const res = await Models.Email.findAll({
    attributes: ["threadId"],
    group: ["threadId"],
    where: {
      status: {
        [Op.eq]: THREAD_JOB_STATUS_ENUM.PENDING_SYNC_TO_GDRIVE,
      },
    },
    raw: true,
    limit,
  });
  return res.map((thread) => thread.threadId);
}

export async function getAllMessageIdsToSyncWithGoogleDrive(
  limit = 250
): String[] {
  const res = await Models.Email.findAll({
    attributes: ["id"],
    where: {
      status: {
        [Op.eq]: THREAD_JOB_STATUS_ENUM.PENDING_SYNC_TO_GDRIVE,
      },
    },
    raw: true,
    limit,
  });
  return res.map((thread) => thread.id);
}

export async function bulkUpsertThreadJobStatuses(threads) {
  threads = _makeArray(threads);
  return Models.Thread.bulkCreate(threads, {
    updateOnDuplicate: Object.keys(threads[0]),
  });
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
