import { resetDevelopmentDatabase } from "./development-database";
import { reportDevelopmentToolError } from "./development-tool-errors";

try {
  const result = resetDevelopmentDatabase();
  console.log(
    result.removedFiles.length === 0
      ? `Development database is already empty: ${result.databasePath}`
      : `Reset development database: ${result.databasePath}`,
  );
} catch (error) {
  reportDevelopmentToolError(error);
}
