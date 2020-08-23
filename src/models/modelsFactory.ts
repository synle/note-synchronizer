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

  // introduce bulkUpsert
  Object.keys(Models).forEach((modelName) => {
    Models[modelName].bulkUpsert = function (items, updateOnDuplicate) {
      items = [].concat(items || []);

      if (items.length > 30) {
        return this.bulkCreate(items, { updateOnDuplicate });
      }

      const priKey = this.primaryKeyAttributes[0];
      const promises = [];

      for (const item of items) {
        const promise = new Promise(async (resolve, reject) => {
          const errors = [];
          try {
            await this.create(item);
            return resolve("Created");
          } catch (err) {
            errors.push(err.stack);
          }

          try {
            // try update, if failed, then try create
            await this.update(item, {
              where: {
                [priKey]: item[priKey],
              },
            });
            return resolve("Updated");
          } catch (err) {
            errors.push(err.stack);
          }

          reject(`Upsert failed ${errors.join("\n")}`);
        });
        promises.push(promise);
      }
      return Promise.all(promises);
    };
  });
};
