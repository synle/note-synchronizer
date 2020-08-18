// @ts-nocheck
require("dotenv").config();

import initDatabase from "./src/models/modelsFactory";

import {
  getNoteDestinationFolderId,
  initGoogleApi,
  uploadFile,
} from "./src/crawler/googleApiUtils";

import {
  doGmailWorkPollThreadList,
  doGmailWorkForAllItems,
  doGmailWorkByThreadIds,
} from "./src/crawler/gmailCrawler";

import {
  doGdriveWorkForAllItems,
  doGdriveWorkByThreadIds,
} from "./src/crawler/gdriveCrawler";

import { logger } from "./src/loggers";

async function _doWork() {
  await initDatabase();
  await initGoogleApi();

  _uploadLogsToDrive(); // do first upload of log on page load

  try {
    const command = process.argv[2] || "";
    const targetThreadIds = (process.argv[3] || "")
      .split(",")
      .map((r) => (r || "").trim())
      .filter((r) => !!r);

    logger.warn(
      `Start job with command=${command} threadIds=${targetThreadIds.length}`
    );

    switch (command) {
      case "poll": // poll for email threads from gmail
        await doGmailWorkPollThreadList();
        break;

      // fetch the email details from gmail by the threadid
      case "fetch_all_emails":
        await doGmailWorkForAllItems();
        break;

      case "fetch_selected_emails":
        await doGmailWorkByThreadIds(targetThreadIds);
        break;

      // process emails and send the data to gdrive
      case "process_gdrive_all_emails":
        await doGdriveWorkForAllItems();
        break;

      case "process_gdrive_selected_emails":
        await doGdriveWorkByThreadIds(targetThreadIds);
        break;

      case "playground":
      case "test":
        console.log("Hello world");
        break;
    }
  } catch (e) {
    logger.error(`Main Process Failed: ${e && e.stack} ${e}`);
  }

  logger.info("Shutting down process...");
  process.exit();
}

// periodically upload warning log to gdrive for progress
function _uploadLogsToDrive() {
  uploadFile(
    "...Note_Sync_Log.info",
    "text/plain",
    "./logs/log_warn.data",
    `Note Synchronizer Log`,
    Date.now(),
    false, // not starred
    getNoteDestinationFolderId()
  );

  uploadFile(
    "...Note_Sync_Log.verbose",
    "text/plain",
    "./logs/log_combined.data",
    `Note Synchronizer Log`,
    Date.now(),
    false, // not starred
    getNoteDestinationFolderId()
  );
}
setInterval(
  _uploadLogsToDrive,
  2 * 60 * 1000 * 60 // in hour
);

_doWork();
