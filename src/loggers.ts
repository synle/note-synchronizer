const winston = require("winston");
const { format } = require("winston");
const { combine, timestamp, label, printf } = format;

const prettyJson = format.printf((info) => {
  if (info.message.constructor === Object) {
    info.message = JSON.stringify(info.message, null, 4);
  }
  return `${info.level}: ${info.message}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "debug", // https://github.com/winstonjs/winston#logging-levels
  format: combine(
    format.colorize(),
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
    new winston.transports.Console(), // only use for debugging
    new winston.transports.File({
      filename: "log_error.data",
      level: "error",
    }),
    new winston.transports.File({ filename: "log_combined.data" }),
  ],
});

process.on("unhandledRejection", (reason, p) => {
  logger.error(
    `Unhandled Rejection at: Promise: ${JSON.stringify(reason, null, 2)}`
  );
});
