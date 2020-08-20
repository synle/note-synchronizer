// @ts-nocheck
import { Sequelize } from "sequelize";
import { initDatabase } from "sequelize-typescript-decorators";
import Models from "./modelsSchema";

/**
 * this routine will initialize the database, please only run this once per all...
 */
export default async () => {
  const dbConnectionString = process.env.DB_URL || "";

  // notes such as emails and attachments
  const sequelizeNotes = new Sequelize(
    process.env.DB_NAME || "note_synchronize",
    process.env.DB_USERNAME || "root",
    process.env.DB_PASSWORD || "password",
    {
      dialect: process.env.DB_DIALECT || "mysql" || "sqlite",
      host: process.env.DB_HOST,
      storage: `${dbConnectionString}/database_main.sqlite`,
      logging: process.env.DB_LOGGING === "true",
      pool: {
        max: 5,
        min: 0,
      },
      retry: {
        max: 10,
      },
    }
  );

  const rawModels = Object.keys(Models).map((modelName) => Models[modelName]);

  await initDatabase(sequelizeNotes, rawModels);
};
