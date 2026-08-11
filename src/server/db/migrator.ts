import type { Kysely } from "kysely";
import { Migrator, type MigrationProvider } from "kysely/migration";

import { migrations } from "../../../migrations";
import type { TimeSinceDatabase } from "./types";

class StaticMigrationProvider implements MigrationProvider {
  getMigrations() {
    return Promise.resolve({ ...migrations });
  }
}

export function createMigrator(database: Kysely<TimeSinceDatabase>) {
  return new Migrator({
    db: database,
    provider: new StaticMigrationProvider(),
  });
}
