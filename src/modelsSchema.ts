import {
  Relationship,
  table,
  attribute,
  relationship,
  index,
} from "sequelize-typescript-decorators";

import { DataTypes, Model } from "sequelize";

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
  static as = "Emails";

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
  public date!: string;

  @attribute(Email)
  public attachmentIds!: string;

  @attribute(Email)
  public content!: string;
}
