import {
  Relationship,
  table,
  attribute,
  relationship,
  index,
} from "sequelize-typescript-decorators";

import { DataTypes, Model } from "sequelize";

@table("attachments", {
  timestamps: false,
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
])
export class Attachment extends Model {
  @attribute(Attachment, {
    allowNull: false,
    primaryKey: true,
  })
  public id!: string;

  @attribute(Attachment, { allowNull: false })
  public messageId!: string;

  @attribute(Attachment, { allowNull: false })
  public mimeType!: string;

  @attribute(Attachment, { allowNull: false })
  public fileName!: string;

  @attribute(Attachment, { allowNull: false })
  public path!: string;
}

@table("emails", {
  timestamps: false,
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

  @attribute(Email)
  public body!: string;

  @attribute(Email)
  public subject!: string;

  @attribute(Email)
  public date!: number;

  @attribute(Email)
  public headers!: string;

  @relationship(Email, {
    relationship: Relationship.hasMany,
    sourceKey: "id",
    foreignModel: Attachment,
    foreignKey: "messageId",
    as: "attachments",
  })
  public Attachments!: any[];
}


export default {
  Attachment,
  Email,
}
