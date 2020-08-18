// @ts-nocheck
// adapter for sql
import { Op } from "sequelize";

import { Email, DatabaseResponse, Attachment } from "../types";

import Models from "../models/modelsSchema";

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
export async function bulkUpsertAttachments(attachments) {
  return Models.Attachment.bulkCreate(_makeArray(attachments), {
    updateOnDuplicate: ["mimeType", "fileName", "path", "headers"],
  });
}

export async function getAttachmentByThreadIds(threadId) {
  return Models.Attachment.findAll({
    where: {
      threadId,
    },
  });
}

// emails
export async function getEmailsAndAttachmentByThreadId(threadId): Email[] {
  const matchedResults: DatabaseResponse<Email>[] = await Models.Email.findAll({
    where: {
      threadId,
    },
  });
  return _transformMatchedThreadsResults(matchedResults);
}

export async function getAllEmailsAndAttachments(): Email[] {
  const matchedResults: DatabaseResponse<Email>[] = await Models.Email.findAll(
    {}
  );
  return _transformMatchedThreadsResults(matchedResults);
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

// threads
export async function getAllThreadsToProcess() {
  return Models.Thread.findAll({
    where: {
      processedDate: {
        [Op.eq]: null,
      },
    },
    order: [
      ["updatedAt", "DESC"], // start with the one that changes recenty
    ],
  }).map(({ threadId }) => threadId);
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

// raw content
export async function getAllRawContents() {
  return Models.RawContent.findAll({});
}

export async function getRawContentsByThreadId(threadId) {
  const matchedResults = await Models.RawContent.findAll({
    where: {
      threadId,
    },
  });

  return matchedResults.map((message) =>
    JSON.parse(message.dataValues.rawApiResponse)
  );
}

export async function bulkUpsertRawContents(rawContents) {
  return Models.RawContent.bulkCreate(_makeArray(rawContents), {
    updateOnDuplicate: ["rawApiResponse", "date"],
  });
}
