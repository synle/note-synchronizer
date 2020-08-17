import axios from "axios";
import { logger } from "../loggers";
import { parseHtmlTitle } from "./gmailCrawler";

// default timeout for axios
axios.defaults.timeout = 300;

export const mySignatureTokens = (process.env.MY_SIGNATURE_TOKEN || "").split(
  "|||"
);

export const myEmails = (process.env.MY_EMAIL || "").split("|||");
export const ignoredTokens = (process.env.IGNORED_TOKEN || "").split("|||");

const ignoredUrlTokens = (process.env.IGNORED_URL_TOKENS || "").split("|||");

export enum MimeTypeEnum {
  APP_JSON = "application/json",
  APP_GOOGLE_DOCUMENT = "application/vnd.google-apps.document",
  APP_GOOGLE_FOLDER = "application/vnd.google-apps.folder",
  APP_GOOGLE_PRESENTATION = "application/vnd.google-apps.presentation",
  APP_GOOGLE_SPREADSHEET = "application/vnd.google-apps.spreadsheet",
  APP_MS_XLS = "application/vnd.ms-excel",
  APP_MS_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  APP_MS_PPT = "application/vnd.ms-powerpoint",
  APP_MS_PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  APP_MS_DOC = "application/msword",
  APP_MS_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  APP_XML = "application/xml",
  IMAGE_GIF = "image/gif",
  IMAGE_JPEG = "image/jpeg",
  IMAGE_JPG = "image/jpg",
  IMAGE_PNG = "image/png",
  MULTIPART_ALTERNATIVE = "multipart/alternative",
  MULTIPART_RELATED = "multipart/related",
  TEXT_HTML = "text/html",
  TEXT_PLAIN = "text/plain",
  TEXT_X_AMP_HTML = "text/x-amp-html",
  TEXT_XML = "text/xml",
  TEXT_CSV = "text/csv",
}
const REGEX_URL = /https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/;

export function isStringUrl(string) {
  string = string || "";
  return (
    (string.match(REGEX_URL) || []).length > 0 &&
    ignoredUrlTokens.every(
      (ignoreUrlToken) => !string.toLowerCase().includes(ignoreUrlToken)
    )
  );
}

export function extractUrlFromString(string) {
  return string.match(REGEX_URL)[0];
}

export async function crawlUrl(url) {
  try {
    const response = await axios(url);
    if (!response || response.status !== 200) {
      logger.debug(`Error crawlUrl: ${url} ${response}`);
      return;
    }
    const rawHtmlBody = response.data;

    return {
      subject: parseHtmlTitle(rawHtmlBody) || "",
      body: rawHtmlBody,
    };
  } catch (err) {
    logger.debug(`Error crawlUrl: ${url} ${err} ${err.stack}`);
  }
}
