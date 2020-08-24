// @ts-nocheck
import crypto from "crypto";
import axios from "axios";
import { logger } from "../loggers";
import { parsePageTitle } from "./gmailCrawler";
import { WebContent } from "../types";

// default timeout for axios
axios.defaults.timeout = 4000;

export const mySignatureTokens = (process.env.MY_SIGNATURE_TOKEN || "").split(
  "|||"
);

export const myEmails = (process.env.MY_EMAIL_TOKENS || "").split("|||");
export const interestedEmails = (process.env.INTERESTED_EMAIL_TOKENS || "")
  .split("|||")
  .concat(myEmails);
export const ignoredWordTokens = (process.env.IGNORED_WORD_TOKENS || "").split(
  "|||"
);

const ignoredUrlTokens = (process.env.IGNORED_URL_TOKENS || "").split("|||");

export enum MIME_TYPE_ENUM {
  APP_JSON = "application/json",
  APP_GOOGLE_DOCUMENT = "application/vnd.google-apps.document",
  APP_GOOGLE_FOLDER = "application/vnd.google-apps.folder",
  APP_GOOGLE_PRESENTATION = "application/vnd.google-apps.presentation",
  APP_GOOGLE_SPREADSHEET = "application/vnd.google-apps.spreadsheet",
  APP_GOOGLE_SCRIPT = "application/vnd.google-apps.script",
  APP_MS_XLS = "application/vnd.ms-excel",
  APP_MS_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  APP_MS_PPT = "application/vnd.ms-powerpoint",
  APP_MS_PPTX = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  APP_MS_DOC = "application/msword",
  APP_MS_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  APP_RTF = "application/rtf",
  APP_XML = "application/xml",
  APP_PDF = "application/pdf",
  APP_OCTLET_STREAM = "application/octet-stream",
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
  TEXT_JAVA = "text/x-java",
  TEXT_JAVA_SOURCE = "text/x-java-source",
  TEXT_CSHARP = "text/x-csharp",
}

export enum WORKER_STATUS_ENUM {
  FREE = "FREE",
  BUSY = "BUSY",
}

export enum THREAD_JOB_STATUS_ENUM {
  ERROR_GENERIC = "ERROR_GENERIC",
  ERROR_CRAWL = "ERROR_CRAWL",
  ERROR_THREAD_NOT_FOUND = "ERROR_THREAD_NOT_FOUND",
  ERROR_TIMEOUT = "ERROR_TIMEOUT",
  IN_PROGRESS = "IN_PROGRESS",
  SUCCESS = "SUCCESS",
  SKIPPED = "SKIPPED",
  PENDING = "PENDING",
  PENDING_CRAWL = "PENDING_CRAWL",
  PENDING_PARSE_EMAIL = "PENDING_PARSE_EMAIL",
  PENDING_SYNC_TO_GDRIVE = "PENDING_SYNC_TO_GDRIVE",
}

export enum WORK_ACTION_ENUM {
  FETCH_THREADS = "FETCH_THREADS",
  FETCH_RAW_CONTENT = "FETCH_RAW_CONTENT",
  PARSE_EMAIL = "PARSE_EMAIL",
  GENERATE_CONTAINER_FOLDERS = "GENERATE_CONTAINER_FOLDERS",
  UPLOAD_EMAILS_BY_MESSAGE_ID = "UPLOAD_EMAILS_BY_MESSAGE_ID",
  UPLOAD_LOGS = "UPLOAD_LOGS",
  SINGLE_RUN_PARSE_EMAIL = "SINGLE_RUN_PARSE_EMAIL",
  SINGLE_RUN_UPLOAD_EMAIL = "SINGLE_RUN_UPLOAD_EMAIL",
}

export interface WorkActionRequest {
  id: string;
  action: WORK_ACTION_ENUM;
}

export interface WorkActionResponse extends WorkActionRequest {
  success: boolean;
  error: any;
}

export const REGEX_URL = /[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/i;

export function isStringUrl(string) {
  try {
    string = string || "";
    return (
      (string.match(REGEX_URL) || []).length > 0 &&
      ignoredUrlTokens.every(
        (ignoreUrlToken) => !string.toLowerCase().includes(ignoreUrlToken)
      )
    );
  } catch (err) {
    logger.error(`isStringUrl failed with err=${err} ${string}`);
  }
}

export function extractUrlFromString(string) {
  try {
    const urlMatches = string.match(REGEX_URL);
    if (urlMatches && urlMatches.length > 0) {
      const matchedUrl = urlMatches[0];

      if (matchedUrl.length > 15) return matchedUrl;
    }
  } catch (err) {
    logger.debug(
      `extractUrlFromString failed "${string}" err=${err}. Fall back to empty string for URL`
    );
  }
  return "";
}

export async function crawlUrl(url): Promise<WebContent> {
  if (!url || !isStringUrl(url)) {
    throw `${url} url is is not valid`;
  }

  if (url.indexOf("http") === -1) {
    url = "http://" + url;
  }

  logger.debug(`crawlUrl fetching url=${url}`);

  try {
    const response = await axios(url);
    if (!response || response.status !== 200) {
      logger.debug(`Error crawlUrl: ${url} ${response}`);
      return;
    }
    const rawHtmlBody = response.data;

    return {
      subject: parsePageTitle(rawHtmlBody) || "",
      body: rawHtmlBody,
    };
  } catch (err) {
    return Promise.reject(err);
  }
}

export function get256Hash(string) {
  return crypto.createHash("sha256").update(string).digest("base64");
}

// this get the domain out of the email
export function generateFolderName(string) {
  string = string.toLowerCase();

  if (interestedEmails.some((myEmail) => string.includes(myEmail))) {
    // if sent by me, then group things under the same label
    return `_ME ${string}`;
  }

  if (
    string.includes("gmail") ||
    string.includes("yahoo.com") ||
    string.includes("ymail") ||
    string.includes("hotmail.com") ||
    string.includes("aol.com")
  ) {
    // common email domain, then should use their full name
    return string.trim();
  }

  // break up things after @ and before the last dot
  let domainParts = string.split(/[@.]/g);

  const resParts = [
    domainParts[domainParts.length - 2],
    domainParts[domainParts.length - 1],
  ];

  return resParts.join(".").trim();
}
