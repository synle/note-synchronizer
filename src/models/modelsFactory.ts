// @ts-nocheck
import { Sequelize } from "sequelize";
import { initDatabase } from "sequelize-typescript-decorators";
import Models from "./modelsSchema";
import { logger } from "../loggers";

/**
 * this routine will initialize the database, please only run this once per all...
 */
export default async () => {
  // notes such as emails and attachments
  const dialect = process.env.DB_DIALECT || "mysql" || "sqlite";

  logger.debug(
    `initDatabase start - ${dialect} - ${process.env.DB_HOST} - ${process.env.DB_NAME}`
  );

  if (dialect === "mysql") {
    // mysql
    const sequelize = new Sequelize(
      process.env.DB_NAME || "note_synchronize",
      process.env.DB_USERNAME || "root",
      process.env.DB_PASSWORD || "password",
      {
        dialect,
        host: process.env.DB_HOST,
        logging: process.env.DB_LOGGING === "true",
        pool: {
          max: 1,
          min: 0,
        },
        retry: {
          max: 10,
        },
        dialectOptions: {
          connectTimeout: 120000,
        },
      }
    );
    await initDatabase(
      sequelize,
      Object.keys(Models).map((modelName) => Models[modelName])
    );
  } else {
    // sqlite
    // for scale, I leave each tables as a different database
    const modelNames = Object.keys(Models);
    for (let modelName of modelNames) {
      const sequelize = new Sequelize(
        process.env.DB_NAME || "note_synchronize",
        process.env.DB_USERNAME || "root",
        process.env.DB_PASSWORD || "password",
        {
          dialect,
          storage: `./database.${modelName}.sqlite`,
          logging: process.env.DB_LOGGING === "true",
          retry: {
            max: 25,
          },
        }
      );
      await initDatabase(sequelize, [Models[modelName]]);
    }
  }

  logger.debug("initDatabase Done");
};
