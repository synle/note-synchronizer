// @ts-nocheck
require("dotenv").config();

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
server.get("/api/message/parse/:messageId", async function (req, res, next) {
  const messageId = req.params.messageId;

  const email = await DataUtils.getEmailByMessageId(messageId);

  const urlFromSubject = CommonUtils.extractUrlFromString(email.subject);
  const urlFromBody = CommonUtils.extractUrlFromString(email.rawBody);

  const url_to_crawl = urlFromSubject || urlFromBody;

  try {
    res.send({
      raw: email.rawBody,
      parsed_text: gmailCrawler.tryParseBody(email.rawBody),
      crawled_content: await CommonUtils.crawlUrl(url_to_crawl),
      url_to_crawl,
    });
  } catch (error) {
    res.send({ error: error.stack || JSON.stringify(err) });
  }
  next();
});

server.get("/api/message/sync/:messageId", async function (req, res, next) {
  const messageId = req.params.messageId;

  try {
    const email = await DataUtils.getEmailByMessageId(messageId);

    await gmailCrawler.processMessagesByThreadId(email.threadId);

    await gdriveCrawler.uploadEmailMsgToGoogleDrive(messageId);

    res.send({
      ok: true,
    });
  } catch (error) {
    res.send({ error: error.stack || JSON.stringify(err) });
  }
  next();
});

server.get("/", async function (req, res, next) {
  res.redirect(301, "/public/index.html", next);
});

server.listen(8080, function () {
  console.log("%s listening at %s", server.name, server.url);
});

server.get(
  "/public/*",
  restify.plugins.serveStatic({
    directory: process.cwd(),
    default: "index.html",
  })
);
