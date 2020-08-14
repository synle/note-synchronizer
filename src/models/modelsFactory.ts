import { Sequelize } from "sequelize";
import { initDatabase } from "sequelize-typescript-decorators";
import Models from "./modelsSchema";

/**
 * this routine will initialize the database, please only run this once per all...
 */
export default async () => {
  const dbConnectionString = process.env.DB_URL || "";
  const sequelize = new Sequelize("note_synchronize", "username", "password", {
    dialect: "sqlite",
    storage: dbConnectionString,
    logging: false,
  });

  const models = Object.keys(Models).map(
    (modelName) => Models[modelName]
  );

  await initDatabase(sequelize, models);
};
