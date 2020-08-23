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
    fields: ["threadId"],
  },
  {
    unique: false,
    fields: ["fileName"],
  },
  {
    unique: false,
    fields: ["path"],
  },
  {
    unique: false,
    fields: ["inline"],
  },
  {
    unique: false,
    fields: ["size"],
  },
])
export class Attachment extends Model {
  @attribute(Attachment, {
    allowNull: false,
    primaryKey: true,
    unique: true,
    type: DataTypes.STRING(750),
  })
  id!: string;

  @attribute(Attachment, { allowNull: false, type: DataTypes.STRING(20) })
  threadId!: string;

  @attribute(Attachment, { allowNull: false })
  messageId!: string;

  @attribute(Attachment, { allowNull: false })
  mimeType!: string;

  @attribute(Attachment, { allowNull: false })
  fileName!: string;

  @attribute(Attachment, { type: DataTypes.INTEGER })
  size!: number;

  @attribute(Attachment, { type: DataTypes.TINYINT(1) })
  inline!: number;

  @attribute(Attachment, { allowNull: false })
  path!: string;

  @attribute(Attachment, { type: DataTypes.TEXT })
  headers!: string;
}

@table("threads", {
  timestamps: true,
})
@index([
  {
    unique: false,
    fields: ["status"],
  },
])
export class Thread extends Model {
  @attribute(Thread, {
    allowNull: false,
    primaryKey: true,
    unique: true,
    type: DataTypes.STRING(20),
  })
  threadId!: string;

  @attribute(Thread, { type: DataTypes.BIGINT })
  processedDate!: number;

  @attribute(Thread, { type: DataTypes.INTEGER })
  duration!: number;

  @attribute(Thread, { type: DataTypes.BIGINT })
  totalMessages!: number;

  @attribute(Thread)
  historyId!: string;

  @attribute(Thread)
  snippet!: string;

  @attribute(Thread)
  status!: string;
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
    fields: ["status"],
  },
])
export class Email extends Model {
  @attribute(Email, {
    allowNull: false,
    primaryKey: true,
    unique: true,
    type: DataTypes.STRING(20),
  })
  id!: string;

  @attribute(Email, { allowNull: false, type: DataTypes.STRING(20) })
  threadId!: string;

  @attribute(Email)
  from!: string;

  @attribute(Email, { type: DataTypes.TEXT })
  to!: string;

  @attribute(Email, { type: DataTypes.TEXT })
  bcc!: string;

  @attribute(Email, { type: DataTypes.TEXT })
  subject!: string;

  @attribute(Email, { type: DataTypes.TEXT })
  rawSubject!: string;

  @attribute(Email, { type: "MEDIUMTEXT" })
  body!: string;

  @attribute(Email, { type: "MEDIUMTEXT" })
  rawBody!: string;

  @attribute(Email, { type: DataTypes.BIGINT })
  date!: number;

  @attribute(Email, { type: DataTypes.TEXT })
  labelIds!: string;

  @attribute(Email)
  status!: string;

  @attribute(Email, { type: "MEDIUMTEXT" })
  rawApiResponse!: string;

  @attribute(Email, { type: DataTypes.TEXT })
  headers!: string;
}

export default {
  Attachment,
  Email,
  Thread,
};
