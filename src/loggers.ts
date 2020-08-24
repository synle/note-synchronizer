// @ts-nocheck
import winston from "winston";
import { format } from "winston";
import isPlainObject from "lodash/isPlainObject";

import * as commonUtils from "./crawler/commonUtils";

const { combine, timestamp, printf } = format;

let loggerTraceId = Date.now() + "";
export function initLogger(newLoggerTraceId) {
  loggerTraceId = commonUtils.getMd5Hash(newLoggerTraceId || Date.now());
}

export const logger = winston.createLogger({
  level: globalThis.LOG_LEVEL || process.env.LOG_LEVEL || "debug", // https://github.com/winstonjs/winston#logging-levels
  format: combine(
    timestamp({
      format: "MM/DD hh:mm:ssA",
    }),
    printf(
      (info) =>
        `${info.timestamp} [${info.level.substr(0, 1).toUpperCase()}] ${
          info.message
        }` +
        (info.splat !== undefined
          ? `${info.splat}`
          : " " + `trace=${loggerTraceId}`)
    )
  ),
  transports: [
    // https://github.com/winstonjs/winston/blob/master/docs/transports.md
    new winston.transports.Console(), // only use for debugging
    new winston.transports.File({
      filename: "./logs/log_error.data",
      level: "error",
    }),
    // log all things
    new winston.transports.File({
      filename: "./logs/log_combined.data",
      level: "debug",
    }),
    new winston.transports.File({
      filename: "./logs/log_warn.data",
      level: "warn",
    }),
  ],
});

process.on("unhandledRejection", (reason, p) => {
  if (reason && reason["stack"]) {
    logger.error(`Unhandled Rejection at: Promise:\n${reason["stack"]}`);
  } else {
    logger.error(
      `Unhandled Rejection at: Promise: ${JSON.stringify(reason, null, 2)}`
    );
  }
});

// Override the base console log with winston
console.log = function () {
  return _formatConsoleLogs(logger.debug, arguments);
};
console.error = function () {
  return _formatConsoleLogs(logger.error, arguments);
};
console.info = function () {
  return _formatConsoleLogs(logger.debug, arguments);
};
console.debug = function () {
  return _formatConsoleLogs(logger.debug, arguments);
};

function _formatConsoleLogs(logMethod, args) {
  logMethod.apply(logger, [
    [...args]
      .map((s) => {
        if (Array.isArray(s)) return JSON.stringify(s);
        else if (isPlainObject(s)) return JSON.stringify(s);
        else if (s === undefined) return "undefined";
        else if (s === null) return "null";
        return s;
      })
      .join("\t"),
  ]);
}
