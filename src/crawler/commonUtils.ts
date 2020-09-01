// @ts-nocheck
import crypto from "crypto";
import axios from "axios";
import { logger } from "../loggers";
import { parsePageTitle } from "./gmailCrawler";
import { WebContent } from "../types";
import { REGEX_URL, ignoredUrlTokens, myEmails } from "./appConstantsEnums";

// default timeout for axios
axios.defaults.timeout = 4000;

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

    logger.debug(
      `extractUrlFromString tokens for urlMatches=${JSON.stringify(urlMatches)}`
    );

    if (urlMatches && urlMatches.length > 0) {
      const matchedUrl = urlMatches[0];

      if (matchedUrl.length > 15) return matchedUrl;
    }
  } catch (err) {
    logger.debug(
      `extractUrlFromString failed err=${err}. Fall back to empty string for URL`
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

export function getMd5Hash(string) {
  string = (string || "") + "";
  return crypto.createHash("md5").update(string).digest("hex");
}

// this get the domain out of the email
export function generateFolderName(string) {
  string = string.toLowerCase();

  if (myEmails.some((myEmail) => string.includes(myEmail))) {
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
