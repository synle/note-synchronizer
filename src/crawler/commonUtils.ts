// @ts-nocheck
import crypto from "crypto";
import axios from "axios";
import trim from "lodash/trim";
import { logger } from "../loggers";
import { parsePageTitle } from "./gmailCrawler";
import { WebContent } from "../types";
import { REGEX_URL, ignoredUrlTokens, myEmails } from "./appConstantsEnums";

// default timeout for axios
axios.defaults.timeout = 4000;

export function isStringUrl(string) {
  try {
    string = string || "";
    if (isEmail(string)) {
      return false;
    }
    return (
      (string.match(REGEX_URL) || []).length > 0 &&
      ignoredUrlTokens.every(
        (ignoreUrlToken) =>
          !string.toLowerCase().includes(ignoreUrlToken.toLowerCase())
      )
    );
  } catch (err) {
    logger.error(`isStringUrl failed with err=${err} ${string}`);
  }
}

function isEmail(email) {
  try {
    const re = /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.  [0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return re.test(String(email).toLowerCase());
  } catch (err) {
    return false;
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
  if (!url) {
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
  string = string.toLowerCase().trim();

  if (myEmails.some((myEmail) => string === myEmail.toLowerCase())) {
    // if sent by me, then group things under the same label
    return `_ME`;
  }

  if (
    [
      "gmail",
      "yahoo.com",
      "ymail",
      "hotmail",
      "aol.com",
      "pacbell.net",
      "comcast.net",
      "msn.com",
      "live.com",
      "outlook.com",
      "icloud.com",
      ".edu",
      ".gov",
      ".org",
    ].some((popularEmail) => string.includes(popularEmail.toLowerCase()))
  ) {
    // common email domain, then should use their full name
    return string;
  }

  // break up things after @ and before the last dot
  let domainParts = string.split(/[@.]/g);

  const resParts = [
    domainParts[domainParts.length - 2],
    domainParts[domainParts.length - 1],
  ];

  const res = trim(resParts.join("."), '-.+()"');
  if (res.length === 0) {
    return string;
  }
  return res;
}
