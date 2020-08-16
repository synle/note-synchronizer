const winston = require("winston");
const { format } = require("winston");
const { combine, timestamp, label, printf } = format;

// polyfill for console.log
// var logger = { debug: console.log, info: console.log, error: console.log }

// const prettyJson = format.printf((info) => {
//   if (info.message.constructor === Object) {
//     info.message = JSON.stringify(info.message, null, 4);
//   }
//   return `[${info.level}]: ${info.message}`;
// });

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "debug", // https://github.com/winstonjs/winston#logging-levels
  format: combine(
    format.timestamp({
      format: "HH:mm:ss",
    }),
    format.printf(
      (info) =>
        `${info.timestamp} ${info.level}: ${info.message}` +
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
