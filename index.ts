// @ts-nocheck
require("dotenv").config();

import initDatabase from "./src/models/modelsFactory";

import { initGoogleApi } from "./src/crawler/googleApiUtils";

import {
  doGmailWorkPollThreadList,
  doGmailWorkForAllItems,
  doGmailWorkByThreadIds,
  doDecodeBase64ForRawContent,
} from "./src/crawler/gmailCrawler";

import {
  doGdriveWorkForAllItems,
  doGdriveWorkByThreadIds,
} from "./src/crawler/gdriveCrawler";

import { logger } from "./src/loggers";

async function _doWork() {
  await initDatabase();
  await initGoogleApi();

  try {
    const command = process.argv[2] || "";
    const targetThreadIds = (process.argv[3] || "")
      .split(",")
      .map((r) => (r || "").trim())
      .filter((r) => !!r);

    logger.info(
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
        await doDecodeBase64ForRawContent();
        break;
    }
  } catch (e) {
    logger.error(`Main Process Failed: ${e && e.stack} ${e}`);
  }
}

_doWork();
