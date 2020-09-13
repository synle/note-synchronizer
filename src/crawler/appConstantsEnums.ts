export const mySignatureTokens = (process.env.MY_SIGNATURE_TOKEN || "")
  .split("|||")
  .filter((r) => !!r);

export const myEmails = (process.env.MY_EMAIL_TOKENS || "")
  .split("|||")
  .map((r) => (r || "").trim().toLowerCase())
  .filter((r) => !!r);

export const interestedEmails = (process.env.INTERESTED_EMAIL_TOKENS || "")
  .split("|||")
  .concat(myEmails)
  .map((r) => (r || "").trim().toLowerCase())
  .filter((r) => !!r);

export const ignoredWordTokens = (process.env.IGNORED_WORD_TOKENS || "")
  .split("|||")
  .map((r) => (r || "").trim().toLowerCase())
  .filter((r) => !!r);

export const ignoredUrlTokens = (process.env.IGNORED_URL_TOKENS || "")
  .split("|||")
  .map((r) => (r || "").trim().toLowerCase())
  .filter((r) => !!r);

export const GMAIL_ATTACHMENT_PATH = "./attachments";

export const MAX_TIME_PER_THREAD = 20 * 60 * 1000; // spend up to this many mins per thread

export const WORKER_REFRESH_INTERVAL = 1000;

export const PROCESSED_EMAIL_PREFIX_PATH = "./processed";

export const FORMAT_DATE_TIME1 = "MM/DD/YY hh:mmA";

export const FORMAT_DATE_TIME2 = "YY/MM/DD HH:mm";

export enum MIME_TYPE_ENUM {
  APP_ICS = "application/ics",
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
  APP_APPLE_IWORK = "application/x-iwork-pages-sffpages",
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

export enum REDIS_KEY {
  ALL_MESSAGE_IDS = "ALL_MESSAGE_IDS",
  ALL_THREAD_IDS = "ALL_THREAD_IDS",
  QUEUE_FETCH_RAW_CONTENT = "QUEUE_FETCH_RAW_CONTENT",
  QUEUE_PARSE_EMAIL = "QUEUE_PARSE_EMAIL",
  QUEUE_UPLOAD_EMAILS_BY_MESSAGE_ID = "QUEUE_UPLOAD_EMAILS_BY_MESSAGE_ID",
  QUEUE_SKIPPED_MESSAGE_ID = "QUEUE_SKIPPED_MESSAGE_ID",
  QUEUE_ERROR_UPLOAD_MESSAGE_ID = "QUEUE_ERROR_UPLOAD_MESSAGE_ID",
  QUEUE_ERROR_FETCH_AND_PARSE_THREAD_ID = "QUEUE_ERROR_FETCH_AND_PARSE_THREAD_ID",
  QUEUE_SUCCESS_FETCH_AND_PARSE_THREAD_ID = "QUEUE_SUCCESS_FETCH_AND_PARSE_THREAD_ID",
  QUEUE_SUCCESS_UPLOAD_MESSAGE_ID = "QUEUE_SUCCESS_UPLOAD_MESSAGE_ID",
}

export const REGEX_URL = /[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/i;
