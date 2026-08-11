import {
  resolveDevelopmentDatabasePath,
  seedDevelopmentDatabase,
} from "./development-database";
import { reportDevelopmentToolError } from "./development-tool-errors";
import { openDatabase } from "../src/server/db/database";

let database: ReturnType<typeof openDatabase> | undefined;

try {
  const databasePath = resolveDevelopmentDatabasePath();
  database = openDatabase({ path: databasePath });
  const result = await seedDevelopmentDatabase(database);
  console.log(
    `Seeded ${result.taskCount} tasks across ${result.categoryCount} categories in ${databasePath}.`,
  );
} catch (error) {
  reportDevelopmentToolError(error);
} finally {
  await database?.destroy();
}
