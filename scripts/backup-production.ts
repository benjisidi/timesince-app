import {
  BACKUP_LABELS,
  createProductionBackup,
} from "../src/server/db/production-backup";

function readLabel(arguments_: string[]) {
  const labelIndex = arguments_.indexOf("--label");
  const label = labelIndex === -1 ? undefined : arguments_[labelIndex + 1];

  if (!label || !BACKUP_LABELS.includes(label as never)) {
    throw new Error(`Use --label with one of: ${BACKUP_LABELS.join(", ")}.`);
  }

  return label as (typeof BACKUP_LABELS)[number];
}

try {
  const result = await createProductionBackup({
    label: readLabel(process.argv.slice(2)),
  });
  console.log(`Verified production backup: ${result.backupPath}`);
  console.log(`Checksum: ${result.checksumPath}`);
  if (result.removedBackups.length > 0) {
    console.log(`Expired backups removed: ${result.removedBackups.length}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Production backup failed: ${message}`);
  process.exitCode = 1;
}
