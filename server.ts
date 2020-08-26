// @ts-nocheck
import restify from "restify";
import initDatabase from "./src/models/modelsFactory";
import { initGoogleApi } from "./src/crawler/googleApiUtils";
import * as gmailCrawler from "./src/crawler/gmailCrawler";
import * as DataUtils from "./src/crawler/dataUtils";

require("dotenv").config();

initDatabase();
initGoogleApi();

const server = restify.createServer();
server.get("/api/message/:messageId", async function (req, res, next) {
  let result = {};

  const messageId = req.params.messageId;

  const email = await DataUtils.getEmailByMessageId(messageId);

  try {
    res.send({
      raw: email.rawBody,
      parsed_html: gmailCrawler._parseBodyWithHtml(email.rawBody),
      parsed_text: gmailCrawler._parseBodyWithText(email.rawBody),
    });
  } catch (error) {
    res.send({ error });
  }
  next();
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
