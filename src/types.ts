import { WORK_ACTION_ENUM } from "./crawler/appConstantsEnums";

export interface Headers {
  date: string;
  subject: string;
  from: string;
  to: string;
  bcc: string;
  received: string;
  "message-id": string;
  "content-type": string;
  "delivered-to": string;
  "x-received": string;
  "arc-seal": string;
  "arc-message-signature": string;
  "arc-authentication-results": string;
  "return-path": string;
  "received-spf": string;
  "authentication-results": string;
  "dkim-signature": string;
  "x-google-dkim-signature": string;
  "x-gm-message-state": string;
  "x-google-smtp-source": string;
  "mime-version": string;
  [propName: string]: any;
}

export interface GmailAttachmentResponse {
  fileName: string;
  attachmentId: string;
  mimeType: string;
  [propName: string]: any;
}

export interface GmailMessageResponse {
  id: string;
  threadId: string;
  labelIds: string;
  snippet: string;
  payload: any;
  sizeEstimate: number;
  historyId: string;
  internalDate: string;
}

// custom

export interface Email {
  id: string;
  threadId: string;
  from: string;
  body: string;
  rawBody: string;
  headers: string;
  to: string;
  bcc: string;
  subject: string;
  date: number;
  status: string;
  Attachments: Attachment[];
  isEmailSentByMe: boolean;
  isChat: boolean;
  isEmail: boolean;
  starred: boolean;
}

export interface Attachment {
  id: string;
  messageId: string;
  mimeType: string;
  fileName: string;
  path: string;
  headers: string;
  size: number;
}

export interface WebContent {
  subject: string;
  body: string;
}

export interface WorkActionRequest {
  id: string;
  action: WORK_ACTION_ENUM;
}

export interface WorkActionResponse extends WorkActionRequest {
  success: boolean;
  error: any;
}
