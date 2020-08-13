import { Sequelize } from "sequelize";
import { initDatabase } from "sequelize-typescript-decorators";
import * as AllModelMaps from "./modelsSchema";

/**
 * this routine will initialize the database, please only run this once per all...
 */
export default async () => {
  const dbConnectionString = process.env.DB_URL || "";
  const sequelize = new Sequelize("note_synchronize", "username", "password", {
    dialect: "sqlite",
    storage: "./database.sqlite",
  });


  const models = Object.keys(AllModelMaps).map(
    (modelName) => AllModelMaps[modelName]
  );

  await initDatabase(sequelize, models);
};
