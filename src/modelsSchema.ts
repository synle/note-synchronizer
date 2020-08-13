import {
  Relationship,
  table,
  attribute,
  relationship,
} from "sequelize-typescript-decorators";

import { DataTypes, Model } from "sequelize";

@table("emails")
export class Email extends Model {
  static as = "Emails";

  @attribute(Email, {
    allowNull: false,
    primaryKey: true,
  })
  public id!: string;

  @attribute(Email, { allowNull: false })
  public content!: string;
}
