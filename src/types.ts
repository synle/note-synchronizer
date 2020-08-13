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

export interface Attachment {
  fileName: string;
  attachmentId: string;
  mimeType: string;
  [propName: string]: any;
}

export interface Email {
  id: string;
  threadId: string;
  body?: string;
  attachments?: Attachment[];
  headers: Headers;
  date: number;
}

export interface DatabaseResponse<T> {
  dataValues: T;
  [propName: string]: any;
}
