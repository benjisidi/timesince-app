import { restoreProductionBackup } from "../src/server/db/production-backup";

function readOption(arguments_: string[], option: string): string | undefined {
  const index = arguments_.indexOf(option);
  return index === -1 ? undefined : arguments_[index + 1];
}

try {
  const arguments_ = process.argv.slice(2);
  const backupPath = readOption(arguments_, "--backup");
  const confirmDatabasePath = readOption(arguments_, "--confirm-database");
  if (!backupPath || !confirmDatabasePath) {
    throw new Error(
      "Restore requires --backup <absolute-path> and --confirm-database <absolute-path>.",
    );
  }

  const result = await restoreProductionBackup({
    backupPath,
    confirmDatabasePath,
    confirmServiceStopped: arguments_.includes("--confirm-service-stopped"),
  });
  console.log(`Restored production database: ${result.databasePath}`);
  for (const recoveryPath of result.recoveryPaths) {
    console.log(`Previous database file retained at: ${recoveryPath}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Production restore failed: ${message}`);
  process.exitCode = 1;
}
