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
  const dbLogging = process.env.DB_LOGGING === "true";

  if (dialect === "mysql") {
    // mysql
    const sequelize = new Sequelize(
      process.env.DB_NAME || "note_synchronize",
      process.env.DB_USERNAME || "root",
      process.env.DB_PASSWORD || "password",
      {
        dialect,
        host: process.env.DB_HOST,
        logging: dbLogging ? console.log : false,
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
      items = [].concat(items);

      if (items.length > 150 && updateOnDuplicate) {
        return this.bulkCreate(items, { updateOnDuplicate });
      }

      const priKey = this.primaryKeyAttributes[0];
      const promises = [];

      for (const item of items) {
        const promise = new Promise(async (resolve, reject) => {
          const priVal = item[priKey];

          const foundItem = await this.findOne({
            attributes: [priKey],
            raw: true,
            where: {
              [priKey]: priVal,
            },
          });

          if (!!foundItem) {
            // do an update
            if (dbLogging) {
              logger.debug(
                `${modelName} Upsert with update for ${priKey}=${priVal} ${JSON.stringify(
                  foundItem
                )}`
              );
            }

            try {
              await this.update(item, {
                where: {
                  [priKey]: priVal,
                },
              });
              return resolve("Updated");
            } catch (err) {
              return reject(
                `${modelName} Upsert with Update failed ${JSON.stringify(
                  err.stack || err
                )} item=${JSON.stringify(item)}`
              );
            }
          } else {
            // do a create
            if (dbLogging) {
              logger.debug(
                `${modelName} Upsert with Create for ${priKey}=${priVal}`
              );
            }

            try {
              await this.create(item);
              return resolve("Created");
            } catch (err) {
              return reject(
                `${modelName} Upsert with Create failed ${JSON.stringify(
                  err.stack || err
                )} item=${JSON.stringify(item)}`
              );
            }
          }
        });
        promises.push(promise);
      }
      return Promise.all(promises);
    };
  });
};
