// @ts-nocheck
// adapter for sql
import { Op } from "sequelize";

import { Email, RawContent, DatabaseResponse, Attachment } from "../types";

import Models from "../models/modelsSchema";

import { THREAD_JOB_STATUS } from "./commonUtils";

function _makeArray(arr) {
  return [].concat(arr || []);
}

// attachments
export async function getAttachmentByThreadIds(threadId) {
  return Models.Attachment.findAll({
    where: {
      threadId,
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
// TODO: deprecate me
export async function getAllEmailsToSyncWithGoogleDrive(): Email[] {
  return Models.Email.findAll({
    where: {
      upload_status: {
        [Op.eq]: THREAD_JOB_STATUS.PENDING,
      },
    },
    raw: true,
  });
}

export async function getAllThreadIdsToSyncWithGoogleDrive(): Email[] {
  const res = await Models.Email.findAll({
    attributes: ["threadId"],
    group: ["threadId"],
    where: {
      upload_status: {
        [Op.eq]: THREAD_JOB_STATUS.PENDING,
      },
    },
    order: [
      ["date", "DESC"], // start with the most recent one first
    ],
    raw: true,
  });
  return res.map((thread) => thread.threadId);
}

export async function getEmailsByThreadId(threadId): Email[] {
  return await Models.Email.findAll({
    where: {
      threadId,
    },
    raw: true,
  });
}

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

export async function updateEmailUploadStatus(email) {
  return Models.Email.update(email, {
    where: {
      id: email.id,
    },
  });
}

// threads
export async function getAllThreadIdsToParseEmails(limit) {
  const req = {
    attributes: ["threadId"], // only fetch threadId
    where: {
      status: {
        [Op.eq]: THREAD_JOB_STATUS.PENDING,
      },
    },
    order: [
      ["updatedAt", "DESC"], // start with the one that changes recenty
    ],
    raw: true,
  };

  // only set limit if it's passed in
  if (limit) {
    req.limit = limit;
  }

  const res = await Models.Thread.findAll(req);
  return res.map((thread) => thread.threadId);
}

export async function getAllThreadIdsToFetchRawContents() {
  const req = {
    attributes: ["threadId"], // only fetch threadId
    where: {
      status: {
        [Op.eq]: THREAD_JOB_STATUS.PENDING_CRAWL,
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
      status: THREAD_JOB_STATUS.PENDING,
      duration: null,
      totalMessages: null,
    },
    {
      where: {
        status: THREAD_JOB_STATUS.IN_PROGRESS,
      },
    }
  );

  await Models.Email.update(
    {
      upload_status: THREAD_JOB_STATUS.PENDING,
    },
    {
      where: {
        upload_status: THREAD_JOB_STATUS.IN_PROGRESS,
      },
    }
  );
}

// raw content
export async function getRawContentsByThreadId(
  threadId
): Promise<RawContent[]> {
  const res = await Models.RawContent.findAll({
    where: {
      threadId,
    },
    raw: true,
  });

  return res.map((message) => JSON.parse(message.rawApiResponse));
}

export async function bulkUpsertRawContents(rawContents: RawContent[]) {
  return Models.RawContent.bulkCreate(_makeArray(rawContents), {
    updateOnDuplicate: ["rawApiResponse", "date"],
  });
}
