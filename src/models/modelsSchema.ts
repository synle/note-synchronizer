import {
  Relationship,
  table,
  attribute,
  relationship,
  index,
} from "sequelize-typescript-decorators";

import { DataTypes, Model } from "sequelize";

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

  @attribute(RawContent, { type: DataTypes.TEXT, allowNull: false })
  public rawApiResponse!: string;

  @attribute(RawContent)
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
    fields: ["threadId"],
  },
])
export class Thread extends Model {
  @attribute(Thread, {
    allowNull: false,
    primaryKey: true,
    unique: true,
  })
  public threadId!: string;

  @attribute(Thread)
  public processedDate!: number;

  @attribute(Thread)
  public duration!: number;

  @attribute(Thread)
  public totalMessages!: number;
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

  @attribute(Email)
  public to!: string;

  @attribute(Email)
  public bcc!: string;

  @attribute(Email, { type: DataTypes.TEXT })
  public body!: string;

  @attribute(Email, { type: DataTypes.TEXT })
  public rawBody!: string;

  @attribute(Email)
  public subject!: string;

  @attribute(Email)
  public rawSubject!: string;

  @attribute(Email)
  public date!: number;

  @attribute(Email, { type: DataTypes.TEXT })
  public headers!: string;

  @attribute(Email)
  public labelIds!: string;

  @relationship(Email, {
    relationship: Relationship.hasMany,
    sourceKey: "id",
    foreignModel: Attachment,
    foreignKey: "messageId",
    as: "attachments",
  })
  public Attachments!: any[];
}

export const ModelsNotes = {
  Attachment,
  Email,
};

export const ModelsRaw = {
  RawContent,
  Thread,
};

export default {
  Attachment,
  Email,
  RawContent,
  Thread,
};
