// @ts-nocheck
import {
  Relationship,
  table,
  attribute,
  relationship,
  index,
} from "sequelize-typescript-decorators";

import { DataTypes, Model } from "sequelize";

import { THREAD_JOB_STATUS_ENUM } from "../crawler/commonUtils";

// raw content database
/**
 * this is a raw content response returned from the GMAIL API
 */
@table("raw_contents", {
  timestamps: false,
})
@index([
  {
    unique: false,
    fields: ["threadId"],
  },
  {
    unique: false,
    fields: ["date"],
  },
  {
    unique: false,
    fields: ["createdAt"],
  },
  {
    unique: false,
    fields: ["updatedAt"],
  },
])
export class RawContent extends Model {
  @attribute(RawContent, {
    allowNull: false,
    primaryKey: true,
    unique: true,
  })
  public messageId!: string;

  @attribute(RawContent, { allowNull: false })
  public threadId!: string;

  @attribute(RawContent, { type: "MEDIUMTEXT", allowNull: false })
  public rawApiResponse!: string;

  @attribute(RawContent, { type: DataTypes.BIGINT })
  public date!: number;
}

// parsed emails and threads
/**
 * this is where we store all the email attachments
 */
@table("attachments", {
  timestamps: true,
})
@index([
  {
    unique: false,
    fields: ["messageId"],
  },
  {
    unique: false,
    fields: ["fileName"],
  },
  {
    unique: false,
    fields: ["path"],
  },
])
export class Attachment extends Model {
  @attribute(Attachment, {
    allowNull: false,
    primaryKey: true,
    unique: true,
    type: DataTypes.STRING(750),
  })
  public id!: string;

  @attribute(Attachment, { allowNull: false })
  public threadId!: string;

  @attribute(Attachment, { allowNull: false })
  public messageId!: string;

  @attribute(Attachment, { allowNull: false })
  public mimeType!: string;

  @attribute(Attachment, { allowNull: false })
  public fileName!: string;

  @attribute(Attachment, { allowNull: false })
  public path!: string;

  @attribute(Attachment, { type: DataTypes.TEXT })
  public headers!: string;
}

@table("threads", {
  timestamps: true,
})
@index([
  {
    unique: false,
    fields: ["status"],
  },
  {
    unique: false,
    fields: ["createdAt"],
  },
  {
    unique: false,
    fields: ["updatedAt"],
  },
])
export class Thread extends Model {
  @attribute(Thread, {
    allowNull: false,
    primaryKey: true,
    unique: true,
  })
  public threadId!: string;

  @attribute(Thread, { type: DataTypes.BIGINT })
  public processedDate!: number;

  @attribute(Thread, { type: DataTypes.BIGINT })
  public duration!: number;

  @attribute(Thread, { type: DataTypes.BIGINT })
  public totalMessages!: number;

  @attribute(Thread)
  public historyId!: string;

  @attribute(Thread)
  public snippet!: string;

  @attribute(Thread, {
    defaultValue: THREAD_JOB_STATUS_ENUM.PENDING_CRAWL,
  })
  public status!: string;
}

/**
 * this is the email details
 */
@table("emails", {
  timestamps: true,
})
@index([
  {
    unique: false,
    fields: ["threadId"],
  },
  {
    unique: false,
    fields: ["from"],
  },
  {
    unique: false,
    fields: ["upload_status"],
  },
  {
    unique: false,
    fields: ["createdAt"],
  },
  {
    unique: false,
    fields: ["updatedAt"],
  },
])
export class Email extends Model {
  @attribute(Email, {
    allowNull: false,
    primaryKey: true,
    unique: true,
  })
  public id!: string;

  @attribute(Email, { allowNull: false })
  public threadId!: string;

  @attribute(Email, { allowNull: false })
  public from!: string;

  @attribute(Email, { type: DataTypes.TEXT })
  public to!: string;

  @attribute(Email, { type: DataTypes.TEXT })
  public bcc!: string;

  @attribute(Email, { type: DataTypes.TEXT })
  public subject!: string;

  @attribute(Email, { type: DataTypes.TEXT })
  public rawSubject!: string;

  @attribute(Email, { type: DataTypes.TEXT })
  public body!: string;

  @attribute(Email, { type: "MEDIUMTEXT" })
  public rawBody!: string;

  @attribute(Email, { type: DataTypes.BIGINT })
  public date!: number;

  @attribute(Email, { type: DataTypes.TEXT })
  public headers!: string;

  @attribute(Email, { type: DataTypes.TEXT })
  public labelIds!: string;

  @attribute(Email, {
    defaultValue: THREAD_JOB_STATUS_ENUM.PENDING,
  })
  public upload_status!: string;
}

export default {
  Attachment,
  Email,
  RawContent,
  Thread,
};
