import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";

import type { TimeSinceDatabase } from "./types";

export interface OpenDatabaseOptions {
  path?: string;
}

export function defaultDatabasePath(workingDirectory = process.cwd()) {
  return resolve(workingDirectory, "data", "timesince.sqlite");
}

export function openDatabase(
  options: OpenDatabaseOptions = {},
): Kysely<TimeSinceDatabase> {
  const databasePath =
    options.path ?? process.env.DATABASE_PATH ?? defaultDatabasePath();

  if (databasePath !== ":memory:") {
    mkdirSync(dirname(resolve(databasePath)), { recursive: true });
  }

  const sqlite = new BetterSqlite3(databasePath);
  sqlite.pragma("foreign_keys = ON");

  if (databasePath !== ":memory:") {
    sqlite.pragma("journal_mode = WAL");
  }

  return new Kysely<TimeSinceDatabase>({
    dialect: new SqliteDialect({ database: sqlite }),
  });
}
