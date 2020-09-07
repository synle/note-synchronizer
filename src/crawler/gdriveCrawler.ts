// @ts-nocheck
require("dotenv").config();

import fs from "fs";
import moment from "moment";

import { Document, Media, Packer, Paragraph, HeadingLevel } from "docx";

import { Email, Attachment } from "../types";
import * as googleApiUtils from "./googleApiUtils";
import { logger } from "../loggers";
import {
  THREAD_JOB_STATUS_ENUM,
  MIME_TYPE_ENUM,
  PROCESSED_EMAIL_PREFIX_PATH,
  FORMAT_DATE_TIME1,
  FORMAT_DATE_TIME2,
} from "./appConstantsEnums";
import * as commonUtils from "./commonUtils";
import * as mySignatureTokens from "./appConstantsEnums";
import * as DataUtils from "./dataUtils";

let noteDestinationFolderId;

function _sanitizeFileName(string) {
  return string
    .replace("|", " ")
    .replace("[", " ")
    .replace("]", " ")
    .replace("_", " ")
    .replace("-", " ")
    .replace(".", " ")
    .replace(/re:/gi, "")
    .replace(/fwd:?/gi, "")
    .replace(/fw:?/gi, "")
    .split(" ")
    .filter((r) => r && r.length > 0)
    .join(" ")
    .trim();
}

export async function generateDocFile(subject, sections, newFileName) {
  logger.debug(`generateDocFile subject=${subject} file=${newFileName}`);
  const doc = new Document();
  const children = [];

  children.push(
    new Paragraph({
      text: subject,
      heading: HeadingLevel.HEADING_2,
      color: "#ff0000",
    })
  );

  sections = [].concat(sections);
  for (let section of sections) {
    let body = section.body;
    let images = section.images;

    body = body
      .split("\n")
      .map((r) => r.trim())
      .filter((r) => !!r);
    for (let content of body) {
      children.push(
        new Paragraph({
          text: content,
          spacing: {
            before: 250,
            after: 250,
          },
          heading: HeadingLevel.HEADING_3,
        })
      );
    }

    if (images.length > 0) {
      for (const attachment of images) {
        const attachmentImage = Media.addImage(
          doc,
          fs.readFileSync(attachment.path),
          700,
          800
        );
        children.push(
          new Paragraph({
            text: `${attachment.fileName}`,
            bold: true,
            heading: HeadingLevel.HEADING_4,
            spacing: {
              before: 250,
            },
            border: {
              bottom: {
                color: "auto",
                space: 1,
                value: "single",
                size: 6,
              },
            },
          })
        );
        children.push(new Paragraph(attachmentImage));
      }
    }
  }

  doc.addSection({
    children,
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(newFileName, buffer);

  logger.debug(
    `generateDocFile - Success subject=${subject} file=${newFileName}`
  );

  return newFileName;
}

export function _getImageAttachments(attachments: Attachment[]): Attachment[] {
  return attachments.filter((attachment) => {
    return attachment.mimeType.includes("image");
  });
}

export function _getNonImagesAttachments(
  attachments: Attachment[]
): Attachment[] {
  return attachments.filter((attachment) => {
    return !attachment.mimeType.includes("image");
  });
}

async function _init() {
  if (!noteDestinationFolderId) {
    noteDestinationFolderId = await googleApiUtils.getNoteDestinationFolderId();
  }

  logger.debug(
    `ID for Google Drive Note Sync Folder: ${noteDestinationFolderId}`
  );
}

async function _processThreadEmail(email: Email) {
  let { threadId, id, from, bcc, to, subject, date, labelIds } = email;
  logger.debug(`_processThreadEmail threadId=${threadId} id=${id}`);

  let docDriveFileId;

  try {
    await DataUtils.bulkUpsertEmails({
      id,
      status: THREAD_JOB_STATUS_ENUM.IN_PROGRESS,
    });

    const Attachments = await DataUtils.getAttachmentsByMessageId(id);

    const toEmailList = (bcc || "")
      .split(",")
      .concat((to || "").split(","))
      .map((r) => r.trim())
      .filter((r) => !!r);

    const nonImageAttachments: Attachment[] = _getNonImagesAttachments(
      Attachments
    );
    const imagesAttachments: Attachment[] = _getImageAttachments(Attachments);

    const labelIdsList = (labelIds || "").split(",");

    const rawBody = (email.rawBody || "").trim();

    const body = email.body || rawBody;

    const toEmailAddresses = toEmailList.join(", ");

    const isEmailSentByMe = mySignatureTokens.interestedEmails.some((myEmail) =>
      from.includes(myEmail)
    );

    const isEmailSentByMeToMe =
      isEmailSentByMe &&
      mySignatureTokens.interestedEmails.some((myEmail) =>
        toEmailList.some((toEmail) => toEmail.includes(myEmail))
      );

    const starred =
      labelIdsList.some((labelId) => labelId.includes("STARRED")) ||
      isEmailSentByMeToMe;

    const hasSomeAttachments =
      nonImageAttachments.length > 0 || imagesAttachments.length > 0;

    const friendlyDateTimeString1 = moment(parseInt(date) * 1000).format(
      FORMAT_DATE_TIME1
    );

    const friendlyDateTimeString2 = moment(parseInt(date) * 1000).format(
      FORMAT_DATE_TIME2
    );

    let isChat = false;
    let isEmail = true;

    if (labelIdsList.some((labelId) => labelId.includes("CHAT"))) {
      isChat = true;
      isEmail = false;
      subject = `${friendlyDateTimeString2} Chat : ${subject}`;
    } else {
      subject = `${friendlyDateTimeString2} ${subject}`;
    }

    let docFileName = `${subject}`;

    const googleFileAppProperties = {
      id,
      threadId,
    };

    // ignored if content contains the ignored patterns
    if (
      mySignatureTokens.ignoredWordTokens.some((ignoredToken) =>
        rawBody.toLowerCase().includes(ignoredToken)
      ) ||
      mySignatureTokens.ignoredWordTokens.some((ignoredToken) =>
        subject.toLowerCase().includes(ignoredToken)
      )
    ) {
      logger.debug(
        `Skipped due to Ignored Pattern: threadId=${threadId} id=${id} subject=${subject}`
      );

      await DataUtils.bulkUpsertEmails({
        id,
        status: THREAD_JOB_STATUS_ENUM.SKIPPED,
      });

      return; // skip this
    }

    if (isChat) {
      logger.debug(
        `Skipped due to content being chat threadId=${threadId} id=${id} subject=${subject}`
      );

      await uploadEmailThreadToGoogleDrive(email.threadId);

      return; // skip this
    }

    if (isEmailSentByMe || isEmailSentByMeToMe || hasSomeAttachments) {
      // create the bucket folder
      const parentFolderName = commonUtils.generateFolderName(from);
      const folderIdToUse = await googleApiUtils.createDriveFolder({
        name: parentFolderName,
        description: `Chats & Emails from ${parentFolderName}`,
        parentFolderId: noteDestinationFolderId,
        starred: isEmailSentByMe,
        folderColorRgb: isEmailSentByMe ? "#FF0000" : "#0000FF",
        appProperties: {
          fromDomain: parentFolderName,
        },
      });

      // update the folder id into the database
      await DataUtils.bulkUpsertFolders({
        folderName: parentFolderName,
        driveFileId: folderIdToUse,
      });

      // upload the doc itself
      // only log email if there're some content
      const localPath = `${PROCESSED_EMAIL_PREFIX_PATH}/processed.${email.id}.docx`;

      logger.debug(
        `Start upload original note threadId=${threadId} id=${id} subject=${subject} imageFiles=${imagesAttachments.length} nonImageAttachments=${nonImageAttachments.length}`
      );

      if (rawBody.length > 0) {
        docFileName = _sanitizeFileName(subject);
        const docSha = commonUtils.get256Hash(docFileName);

        try {
          await generateDocFile(
            subject,
            {
              body: `
              Date: ${friendlyDateTimeString1}
              Uploaded: ${moment().format(FORMAT_DATE_TIME1)}
              From: ${from}
              To: ${toEmailAddresses}
              ThreadId: ${threadId}
              MessageId: ${id}
              SHA: ${docSha}
              ================================================
              ${body}
              `,
              images: imagesAttachments,
            },
            localPath
          );

          logger.debug(`Upload original note file ${docFileName}`);

          // upload original doc
          docDriveFileId = await googleApiUtils.uploadFile({
            name: docFileName,
            mimeType: MIME_TYPE_ENUM.APP_MS_DOCX,
            localPath: localPath,
            description: `
            Main Email
            Date: ${friendlyDateTimeString1}

            From: ${from}

            Subject: ${subject}

            ThreadId: ${threadId}

            MessageId: ${id}

            SHA: ${docSha}
            `.trim(),
            date: date,
            starred: starred,
            parentFolderId: folderIdToUse,
            appProperties: {
              sha: docSha,
              ...googleFileAppProperties,
            },
          });
        } catch (err) {
          logger.error(
            `Error - Failed to upload original note - threadId=${threadId} id=${id} subject=${subject} attachmentName=${docFileName} localPath=${localPath} error=${JSON.stringify(
              err.stack || err
            )}`
          );
        }
      }

      // then upload the associated attachments
      logger.debug(
        `Start upload attachment job threadId=${threadId} id=${id} subject=${subject} ${nonImageAttachments.length}`
      );
      let AttachmentIdx = 0;
      for (let attachment of nonImageAttachments) {
        AttachmentIdx++;
        const attachmentName = _sanitizeFileName(
          `${docFileName} #${AttachmentIdx} ${attachment.fileName}`
        );

        logger.debug(
          `Upload Attachment threadId=${threadId} id=${id} subject=${subject} attachmentName=${attachmentName} ${attachment.mimeType}`
        );

        try {
          // upload attachment
          const attachmentSha = commonUtils.get256Hash(attachment.id);

          const attachmentDriveFileId = await googleApiUtils.uploadFile({
            name: attachmentName,
            mimeType: attachment.mimeType,
            localPath: attachment.path,
            description: `
            Attachment #${AttachmentIdx}

            Date: ${friendlyDateTimeString1}

            From: ${from}

            Subject: ${subject}

            ThreadId: ${threadId}

            MessageId: ${id}

            Path: ${attachment.path}

            AttachmentId: ${attachment.id.substr(0, 50)}

            SHA:
            ${attachmentSha}
            `.trim(),
            date: date,
            starred: starred,
            parentFolderId: folderIdToUse,
            appProperties: {
              sha: attachmentSha,
              ...googleFileAppProperties,
            },
          });

          await DataUtils.bulkUpsertAttachments({
            id: attachment.id,
            driveFileId: attachmentDriveFileId,
          });
        } catch (err) {
          logger.error(
            `Error - Failed upload attachment - threadId=${threadId} id=${id} subject=${subject} attachmentName=${attachmentName} ${
              attachment.mimeType
            } path=${attachment.path} error=${JSON.stringify(err.stack || err)}`
          );
        }
      }
    } else {
      logger.debug(`Skipped threadId=${threadId} id=${id} subject=${subject}`);
    }

    await DataUtils.bulkUpsertEmails({
      id: id,
      status: THREAD_JOB_STATUS_ENUM.SUCCESS,
      driveFileId: docDriveFileId,
    });
  } catch (err) {
    logger.error(
      `Failed to upload emails with threadId=${email.threadId} messageId=${
        email.id
      } error=${JSON.stringify(err.stack || err)}`
    );

    await DataUtils.bulkUpsertEmails({
      id: id,
      status: THREAD_JOB_STATUS_ENUM.ERROR_GENERIC,
    });
  }
}

export async function uploadEmailMsgToGoogleDrive(messageId) {
  await _init();
  const email = await DataUtils.getEmailByMessageId(messageId);
  if (email) {
    await _processThreadEmail(email);
  } else {
    logger.error(`Cannot find message with messageId=${messageId}`);
  }
}

async function _processThreads(threadId, emails: Email[]) {
  let folderId;
  let docDriveFileId;
  let docFileName;
  let docContentSections = [];
  let starred = false;
  let dateStart;
  let dateEnd;
  let date;
  let isEmailSentByMe;
  let isEmailSentByMeToMe;

  const googleFileAppProperties = {
    threadId,
  };

  // all attachments
  const attachments = await DataUtils.getAttachmentsByThreadId(threadId);
  const allNonImageAttachments: Attachment[] = _getNonImagesAttachments(
    attachments
  );
  const hasSomeAttachments = allNonImageAttachments.length > 0;

  // involvedEmails
  let emailAddresses = [];
  let from;

  for (let email of emails) {
    emailAddresses = emailAddresses
      .concat((email.from || "").split(","))
      .concat((email.bcc || "").split(","))
      .concat((email.to || "").split(","))
      .map((r) => r.trim())
      .filter((r) => !!r);

    const toEmailList = []
      .concat((email.bcc || "").split(","))
      .concat((email.to || "").split(","))
      .map((r) => r.trim())
      .filter((r) => !!r);
    const toEmailAddresses = toEmailList.join(", ");

    isEmailSentByMe =
      isEmailSentByMe ||
      mySignatureTokens.interestedEmails.some((myEmail) =>
        email.from.includes(myEmail)
      );

    isEmailSentByMeToMe =
      isEmailSentByMeToMe ||
      (isEmailSentByMe &&
        mySignatureTokens.interestedEmails.some((myEmail) =>
          toEmailList.some((toEmail) => toEmail.includes(myEmail))
        ));

    const attachments = await DataUtils.getAttachmentsByMessageId(email.id);
    const images: Attachment[] = _getImageAttachments(attachments);

    const friendlyDateTimeString1 = moment(parseInt(email.date) * 1000).format(
      FORMAT_DATE_TIME1
    );

    const friendlyDateTimeString2 = moment(parseInt(email.date) * 1000).format(
      FORMAT_DATE_TIME2
    );

    if (!dateStart) {
      dateStart = friendlyDateTimeString1;
    }
    dateEnd = friendlyDateTimeString1;

    const labelIdsList = (email.labelIds || "").split(",");

    let isChat = false;
    let isEmail = true;
    let subject = email.subject;
    if (labelIdsList.some((labelId) => labelId.includes("CHAT"))) {
      isChat = true;
      isEmail = false;
      subject = `${friendlyDateTimeString2} Chat : ${subject}`;
    } else {
      subject = `${friendlyDateTimeString2} ${subject}`;
    }
    if (!docFileName) {
      docFileName = subject;
    }

    if (!from) {
      from = email.from;
    }

    if (isEmailSentByMe) {
      starred = true;
    }

    date = email.date;

    if (!folderId) {
      // create the parent folder
      const folderName = commonUtils.generateFolderName(email.from);
      folderId = await googleApiUtils.createDriveFolder({
        name: folderName,
        description: `Chats & Emails from ${folderName}`,
        parentFolderId: noteDestinationFolderId,
        starred,
        folderColorRgb: starred ? "#FF0000" : "#0000FF",
        appProperties: {
          fromDomain: folderName,
        },
      });

      // update the folder id into the database
      await DataUtils.bulkUpsertFolders({
        folderName: folderName,
        driveFileId: folderId,
      });

      // create the folder that are grouped by year
      // this is where we will store the data
      const yearString = moment(parseInt(email.date) * 1000).format("YYYY");
      folderId = await googleApiUtils.createDriveFolder({
        name: yearString,
        description: `Chats & Emails from ${folderName} in year ${yearString}`,
        parentFolderId: folderId,
        starred,
        folderColorRgb: "#00FFFF",
        appProperties: {
          fromDomainAndYear: `${folderName}-${yearString}`,
        },
      });
    }

    // concatenate body
    if (isChat) {
      docContentSections.push({
        body: `
        ================================================
        ${friendlyDateTimeString1} ${from}:
        ${email.body}
      `,
        images,
      });
    } else {
      docContentSections.push({
        body: `
        ================================================
        Subject: ${subject}
        Date: ${friendlyDateTimeString1}
        Uploaded: ${moment().format(FORMAT_DATE_TIME1)}
        From: ${from}
        To: ${toEmailAddresses}
        ThreadId: ${threadId}
        MessageId: ${email.id}
        ================================================
        ${email.body}
      `,
        images,
      });
    }
  }

  if (isEmailSentByMe || isEmailSentByMeToMe || hasSomeAttachments) {
    emailAddresses = [...new Set(emailAddresses)];

    const docLocalPath = `${PROCESSED_EMAIL_PREFIX_PATH}/processed.threadId.${threadId}.docx`;

    await generateDocFile(docFileName, docContentSections, docLocalPath);

    const docSha = commonUtils.get256Hash(`${threadId}.mainEmail`);

    docDriveFileId = await googleApiUtils.uploadFile({
      name: docFileName,
      mimeType: MIME_TYPE_ENUM.APP_MS_DOCX,
      localPath: docLocalPath,
      description: `
    Main Email
    From:
    ${from}

    Date: ${dateStart} - ${dateEnd}

    Path:
    ${docLocalPath}

    SHA:
    ${docSha}

    ThreadId:
    ${threadId}
    `
        .split("\n")
        .map((r) => r.trim())
        .join("\n"),
      date,
      starred,
      parentFolderId: folderId,
      appProperties: {
        sha: docSha,
        ...googleFileAppProperties,
      },
    });

    logger.debug(
      `Link to google doc:\nhttps://docs.google.com/document/d/${docDriveFileId}`
    );

    // upload attachments
    let attachmentIdx = 1;
    for (let attachment of allNonImageAttachments) {
      attachmentIdx++;
      const attachmentName = _sanitizeFileName(
        `${docFileName} #${attachmentIdx} ${attachment.fileName}`
      );

      logger.debug(
        `Upload Attachment threadId=${threadId} attachmentName=${attachmentName} ${attachment.mimeType}`
      );

      try {
        // upload attachment
        const attachmentSha = commonUtils.get256Hash(attachment.id);

        const attachmentDriveFileId = await googleApiUtils.uploadFile({
          name: attachmentName,
          mimeType: attachment.mimeType,
          localPath: attachment.path,
          description: `
        Attachment #${attachmentIdx}
        From:
        ${from}

        Date: ${dateStart} - ${dateEnd}

        ThreadId:
        ${threadId}

        Path:
        ${attachment.path}

        SHA:
        ${attachmentSha}

        AttachmentId:
        ${attachment.id.substr(0, 25)}
        `
            .split("\n")
            .map((r) => r.trim())
            .join("\n"),
          date,
          starred,
          parentFolderId: folderId,
          appProperties: {
            sha: attachmentSha,
            ...googleFileAppProperties,
          },
        });

        await DataUtils.bulkUpsertAttachments({
          id: attachment.id,
          driveFileId: attachmentDriveFileId,
        });
      } catch (err) {
        logger.error(
          `Error - Failed upload attachment - threadId=${threadId} attachmentName=${attachmentName} ${
            attachment.mimeType
          } path=${attachment.path} error=${JSON.stringify(err.stack || err)}`
        );
      }
    }

    await DataUtils.bulkUpsertEmails(
      emails.map((email) => {
        return {
          ...email,
          status: THREAD_JOB_STATUS_ENUM.SUCCESS,
          driveFileId: docDriveFileId,
        };
      })
    );
  } else {
    await DataUtils.bulkUpsertEmails(
      emails.map((email) => {
        return {
          ...email,
          status: THREAD_JOB_STATUS_ENUM.SKIPPED,
          driveFileId: docDriveFileId,
        };
      })
    );
  }
}

export async function uploadEmailThreadToGoogleDrive(threadId) {
  await _init();
  const emails = await DataUtils.getEmailsByThreadId(threadId);
  if (emails.length > 0) {
    await _processThreads(threadId, emails);
  } else {
    logger.error(`Cannot find message with threadId=${threadId}`);
  }
}

export async function uploadLogsToDrive() {
  await _init();

  logger.debug("uploadLogsToDrive");

  googleApiUtils.uploadFile(
    "...Note_Sync_Log.info",
    "text/plain",
    "./logs/log_warn.data",
    `Note Synchronizer Log`,
    Date.now(),
    false, // not starred
    noteDestinationFolderId
  );

  googleApiUtils.uploadFile(
    "...Note_Sync_Log.verbose",
    "text/plain",
    "./logs/log_combined.data",
    `Note Synchronizer Log`,
    Date.now(),
    false, // not starred
    noteDestinationFolderId
  );
}
