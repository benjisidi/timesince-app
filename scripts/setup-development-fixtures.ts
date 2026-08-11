import { createMigrator } from "../src/server/db/migrator";
import { openDatabase } from "../src/server/db/database";
import {
  resetDevelopmentDatabase,
  seedDevelopmentDatabase,
} from "./development-database";
import { reportDevelopmentToolError } from "./development-tool-errors";

let database: ReturnType<typeof openDatabase> | undefined;

try {
  const { databasePath } = resetDevelopmentDatabase();
  database = openDatabase({ path: databasePath });
  const migration = await createMigrator(database).migrateToLatest();
  if (migration.error) {
    throw migration.error;
  }

  const result = await seedDevelopmentDatabase(database);
  console.log(
    `Reset, migrated, and seeded ${result.taskCount} tasks across ${result.categoryCount} categories in ${databasePath}.`,
  );
} catch (error) {
  reportDevelopmentToolError(error);
} finally {
  await database?.destroy();
}
