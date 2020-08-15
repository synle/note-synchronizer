import { Sequelize } from "sequelize";
import { initDatabase } from "sequelize-typescript-decorators";
import { ModelsNotes, ModelsRaw } from "./modelsSchema";

/**
 * this routine will initialize the database, please only run this once per all...
 */
export default async () => {
  const dbConnectionString = process.env.DB_URL || "";

  // notes such as emails and attachments
  const sequelizeNotes = new Sequelize(
    "note_synchronize",
    "username",
    "password",
    {
      dialect: "sqlite",
      storage: `${dbConnectionString}/database_main.sqlite`,
      logging: false,
    }
  );

  const modelsNotes = Object.keys(ModelsNotes).map(
    (modelName) => ModelsNotes[modelName]
  );

  await initDatabase(sequelizeNotes, modelsNotes);

  // raw response database
  const sequelizeRaw = new Sequelize(
    "note_synchronize",
    "username",
    "password",
    {
      dialect: "sqlite",
      storage: `${dbConnectionString}/database_raw.sqlite`,
      logging: false,
    }
  );

  const modelsRaw = Object.keys(ModelsRaw).map(
    (modelName) => ModelsRaw[modelName]
  );

  await initDatabase(sequelizeRaw, modelsRaw);
};
