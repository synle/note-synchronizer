// @ts-nocheck
require("dotenv").config();
const { exec } = require("child_process");

import path from "path";
import restify from "restify";
import initDatabase from "./src/models/modelsFactory";
import { initGoogleApi } from "./src/crawler/googleApiUtils";
import * as DataUtils from "./src/crawler/dataUtils";
import * as gmailCrawler from "./src/crawler/gmailCrawler";
import * as gdriveCrawler from "./src/crawler/gdriveCrawler";
import * as CommonUtils from "./src/crawler/commonUtils";

initDatabase();
initGoogleApi();

const server = restify.createServer();

server.use(restify.plugins.bodyParser({ mapParams: false }));

server.get("/api/message/parse/threadId/:threadId", async function (
  req,
  res,
  next
) {
  const threadId = req.params.threadId;

  const emails = await DataUtils.getEmailsByThreadId(threadId);
  if (emails.length > 0) {
    for (let email of emails) {
      let url_to_crawl;

      try {
        url_to_crawl = CommonUtils.extractUrlFromString(email.subject);
      } catch (err) {}

      try {
        url_to_crawl = CommonUtils.extractUrlFromString(email.rawBody);
      } catch (err) {}

      let crawled_content;
      try {
        crawled_content = await CommonUtils.crawlUrl(url_to_crawl);
      } catch (err) {
        console.error(err);
      }

      try {
        res.send({
          raw: email.rawBody,
          parsed_text: gmailCrawler.tryParseBody(email.rawBody),
          crawled_content,
          url_to_crawl,
        });
      } catch (error) {
        res.send(500, { error: error.stack || JSON.stringify(error) });
      }
    }
  } else {
    res.send(404, { error: "Not found" });
  }
  next();
});

server.get("/api/message/parse/messageId/:messageId", async function (
  req,
  res,
  next
) {
  const messageId = req.params.messageId;

  const email = await DataUtils.getEmailByMessageId(messageId);
  if (email) {
    let url_to_crawl;

    try {
      url_to_crawl = CommonUtils.extractUrlFromString(email.subject);
    } catch (err) {}

    try {
      url_to_crawl = CommonUtils.extractUrlFromString(email.rawBody);
    } catch (err) {}

    let crawled_content;
    try {
      crawled_content = await CommonUtils.crawlUrl(url_to_crawl);
    } catch (err) {}

    try {
      res.send({
        raw: email.rawBody,
        parsed_text: gmailCrawler.tryParseBody(email.rawBody),
        crawled_content,
        url_to_crawl,
      });
    } catch (error) {
      res.send({ error: error.stack || JSON.stringify(error) });
    }
  } else {
    res.send(404, { error: "Not found" });
  }
  next();
});

server.get("/api/message/sync/messageId/:messageId", async function (
  req,
  res,
  next
) {
  const messageId = req.params.messageId;

  try {
    const email = await DataUtils.getEmailByMessageId(messageId);

    if (!email) {
      throw `Not found messageId=${messageId}`;
    }

    await gmailCrawler.processMessagesByThreadId(email.threadId);

    await gdriveCrawler.uploadEmailMsgToGoogleDrive(email.id);

    res.send({
      ok: true,
    });
  } catch (error) {
    res.send({ error: error.stack || JSON.stringify(err) });
  }
  next();
});

server.get("/api/message/sync/threadId/:threadId", async function (
  req,
  res,
  next
) {
  const threadId = req.params.threadId;

  try {
    const emails = await DataUtils.getEmailsByThreadId(threadId);

    if (emails.length === 0) {
      throw `Not found threadId=${threadId}`;
    }

    for (let email of emails) {
      await gmailCrawler.processMessagesByThreadId(email.threadId);
      await gdriveCrawler.uploadEmailMsgToGoogleDrive(email.id);
    }

    res.send({
      ok: true,
    });
  } catch (error) {
    res.send({ error: error.stack || JSON.stringify(error) });
  }
  next();
});

server.post("/api/logs", async function (req, res, next) {
  try {
    const search = JSON.parse(req.body).search;
    const cmd = `cat logs/log_combined.data | grep -i "${search}" | tail -100000`;
    exec(cmd, { maxBuffer: 512 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        res.send({ error: error.stack || JSON.stringify(error) });
        return;
      }
      res.send({
        ok: true,
        msg: stdout,
      });
    });
  } catch (error) {
    res.send({ error: error.stack || JSON.stringify(error) });
  }
  next();
});

server.get("/", async function (req, res, next) {
  res.redirect(301, "/public/index.html", next);
});

server.listen(process.env.PORT || 8080, function () {
  console.log("%s listening at %s", server.name, server.url);
});

server.get(
  "/public/*",
  restify.plugins.serveStatic({
    directory: path.join(process.cwd(), "src"),
    default: "index.html",
  })
);
