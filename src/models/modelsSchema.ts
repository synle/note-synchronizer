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
  public id!: string;

  @attribute(Attachment, { allowNull: false })
  public threadId!: string;

  @attribute(Attachment, { allowNull: false })
  public messageId!: string;

  @attribute(Attachment, { allowNull: false })
  public mimeType!: string;

  @attribute(Attachment, { allowNull: false })
  public fileName!: string;

  @attribute(Attachment, { type: DataTypes.INTEGER })
  public size!: number;

  @attribute(Attachment, { type: DataTypes.TINYINT(1) })
  public inline!: number;

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

  @attribute(Thread)
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
export class Email extends Model {
  @attribute(Email, {
    allowNull: false,
    primaryKey: true,
    unique: true,
  })
  public id!: string;

  @attribute(Email, { allowNull: false })
  public threadId!: string;

  @attribute(Email)
  public from!: string;

  @attribute(Email, { type: DataTypes.TEXT })
  public to!: string;

  @attribute(Email, { type: DataTypes.TEXT })
  public bcc!: string;

  @attribute(Email, { type: DataTypes.TEXT })
  public subject!: string;

  @attribute(Email, { type: DataTypes.TEXT })
  public rawSubject!: string;

  @attribute(Email, { type: "MEDIUMTEXT" })
  public body!: string;

  @attribute(Email, { type: "MEDIUMTEXT" })
  public rawBody!: string;

  @attribute(Email, { type: DataTypes.BIGINT })
  public date!: number;

  @attribute(Email, { type: DataTypes.TEXT })
  public labelIds!: string;

  @attribute(Email)
  public status!: string;

  @attribute(Email, { type: "MEDIUMTEXT", allowNull: false })
  public rawApiResponse!: string;

  @attribute(Email, { type: DataTypes.TEXT })
  public headers!: string;
}

export default {
  Attachment,
  Email,
  Thread,
};
