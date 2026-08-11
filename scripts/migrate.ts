import { openDatabase } from "../src/server/db/database";
import { createMigrator } from "../src/server/db/migrator";

const database = openDatabase();

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
