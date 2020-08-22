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
  return Models.Attachment.bulkCreate(_makeArray(attachments), {
    updateOnDuplicate: ["mimeType", "fileName", "path", "headers"],
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

export async function bulkUpsertEmails(
  emails: Email[],
  fieldsToUpdate = [
    "from",
    "body",
    "rawBody",
    "subject",
    "rawSubject",
    "headers",
    "to",
    "bcc",
    "date",
    "status",
    "size",
    "inline",
  ]
) {
  return Models.Email.bulkCreate(_makeArray(emails), {
    updateOnDuplicate: fieldsToUpdate,
  });
}

export async function updateEmailUploadStatus(email: Email) {
  return Models.Email.update(email, {
    where: {
      id: email.id,
    },
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
    order: [
      ["updatedAt", "DESC"], // start with the one that changes recenty
    ],
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
    // order: [
    //   ["updatedAt", "DESC"], // start with the one that changes recenty
    // ],
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
    // order: [
    //   ["date", "DESC"], // start with the most recent one first
    // ],
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
    // order: [
    //   ["date", "DESC"], // start with the most recent one first
    // ],
    raw: true,
    limit,
  });
  return res.map((thread) => thread.id);
}

export async function bulkUpsertThreadJobStatuses(threads) {
  return Models.Thread.bulkCreate(_makeArray(threads), {
    updateOnDuplicate: [
      "processedDate",
      "duration",
      "totalMessages",
      "historyId",
      "snippet",
      "status",
    ],
  });
}

export async function recoverInProgressThreadJobStatus(oldStatus, newStatus) {
  await Models.Thread.update(
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

  await Models.Email.update(
    {
      status: THREAD_JOB_STATUS_ENUM.PENDING_PARSE_EMAIL,
    },
    {
      where: {
        status: THREAD_JOB_STATUS_ENUM.IN_PROGRESS,
      },
    }
  );
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
