const winston = require("winston");
const { format } = require("winston");
const { combine, timestamp, label, printf } = format;

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "debug", // https://github.com/winstonjs/winston#logging-levels
  format: combine(
    format.timestamp({
      format: "MM/DD hh:mm:ssA",
    }),
    format.printf(
      (info) =>
        `${info.timestamp} [${info.level.substr(0,1)}.toUpperCase()] ${info.message}` +
        (info.splat !== undefined ? `${info.splat}` : " ")
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
  return logger.info.apply(logger, [
    "console.log: " + [...arguments].map((s) => JSON.stringify(s)).join(", "),
  ]);
};
console.error = function () {
  return logger.error.apply(logger, [
    "console.error: " + [...arguments].map((s) => JSON.stringify(s)).join(", "),
  ]);
};
console.info = function () {
  return logger.debug.apply(logger, [
    "console.info: " +
      [...arguments].map((s) => "  " + JSON.stringify(s)).join(", "),
  ]);
};
console.debug = function () {
  return logger.debug.apply(logger, [
    "console.debug: " + [...arguments].map((s) => JSON.stringify(s)).join(", "),
  ]);
};
console.warn = function () {
  return logger.debug.apply(logger, [
    "console.debug: " + [...arguments].map((s) => JSON.stringify(s)).join(", "),
  ]);
};
