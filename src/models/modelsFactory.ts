// @ts-nocheck
import { Sequelize } from "sequelize";
import { initDatabase } from "sequelize-typescript-decorators";
import Models from "./modelsSchema";

/**
 * this routine will initialize the database, please only run this once per all...
 */
export default async () => {
  // notes such as emails and attachments
  const sequelizeNotes = new Sequelize(
    process.env.DB_NAME || "note_synchronize",
    process.env.DB_USERNAME || "root",
    process.env.DB_PASSWORD || "password",
    {
      dialect: process.env.DB_DIALECT || "mysql" || "sqlite",
      host: process.env.DB_HOST,
      storage: `./database.sqlite`,
      logging: process.env.DB_LOGGING === "true",
      pool: {
        max: 3,
        min: 0,
      },
      retry: {
        max: 25,
      },
      dialectOptions: {
        connectTimeout: 120000,
      },
    }
  );

  const rawModels = Object.keys(Models).map((modelName) => Models[modelName]);

  await initDatabase(sequelizeNotes, rawModels);
};
