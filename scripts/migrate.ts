import { openDatabase } from "../src/server/db/database";
import { createMigrator } from "../src/server/db/migrator";
import { resolveProductionDatabasePath } from "../src/server/db/production-config";
import { resolveDevelopmentDatabasePath } from "./development-database";

function resolveMigrationDatabasePath(arguments_: string[]): string {
  const production = arguments_.includes("--production");
  const development = arguments_.includes("--development");
  if (production === development) {
    throw new Error(
      "Migration mode is required: use exactly one of --development or --production.",
    );
  }

  return production
    ? resolveProductionDatabasePath()
    : resolveDevelopmentDatabasePath();
}

const database = openDatabase({
  path: resolveMigrationDatabasePath(process.argv.slice(2)),
});

try {
  const { error, results = [] } =
    await createMigrator(database).migrateToLatest();

  for (const result of results) {
    console.log(`${result.status}: ${result.migrationName}`);
  }

  if (error) {
    throw error;
  }

  if (results.length === 0) {
    console.log("Database is already up to date.");
  }
} finally {
  await database.destroy();
}
