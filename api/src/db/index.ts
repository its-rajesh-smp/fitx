import { env } from "../config/env";
import knex, { Knex } from "knex";
import { Model } from "objection";
import path from "path";
import knexConfig from "./knexfile";

export const db: Knex = knex(knexConfig[env.ENVIRONMENT]);
Model.knex(db);

// Resolve relative to this file so it works from both `src/` (ts-node in dev)
// and the compiled `dist/` output (production container).
const MIGRATIONS_DIR = path.join(__dirname, "migrations");
const SEEDS_DIR = path.join(__dirname, "seeds");
const LOAD_EXTENSIONS = [".ts", ".js"];

export const runDBMigrations = async () => {
  console.log("Database migrations started");

  await db.migrate.latest({
    directory: MIGRATIONS_DIR,
    loadExtensions: LOAD_EXTENSIONS,
  });

  console.log("Database migrations completed");

  console.log("Database seeds started");

  await db.seed.run({
    directory: SEEDS_DIR,
    loadExtensions: LOAD_EXTENSIONS,
  });

  console.log("Database seeds completed");
};
