import { createHash } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import BetterSqlite3 from "better-sqlite3";

import {
  ProductionDatabaseSafetyError,
  resolveProductionBackupConfig,
  resolveProductionDatabasePath,
} from "./production-config";

export const BACKUP_LABELS = ["daily", "pre-migration", "manual"] as const;
export type BackupLabel = (typeof BACKUP_LABELS)[number];

function timestampForFile(date: Date): string {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

export async function verifySqliteDatabase(path: string): Promise<void> {
  const database = new BetterSqlite3(path, {
    fileMustExist: true,
    readonly: true,
  });

  try {
    const result = database.pragma("integrity_check", { simple: true });
    if (result !== "ok") {
      throw new Error(`SQLite integrity_check returned ${String(result)}.`);
    }
  } finally {
    database.close();
  }
}

async function removeExpiredBackups(
  directory: string,
  retentionCount: number,
): Promise<string[]> {
  const backupFiles = (await readdir(directory))
    .filter((file) => file.endsWith(".sqlite"))
    .sort()
    .reverse();
  const removed: string[] = [];

  for (const file of backupFiles.slice(retentionCount)) {
    const backupPath = join(directory, file);
    await rm(backupPath, { force: true });
    await rm(`${backupPath}.sha256`, { force: true });
    removed.push(backupPath);
  }

  return removed;
}

export interface ProductionBackupResult {
  backupPath: string;
  checksumPath: string;
  removedBackups: string[];
}

export async function createProductionBackup(options: {
  environment?: NodeJS.ProcessEnv;
  label: BackupLabel;
  now?: Date;
  workingDirectory?: string;
}): Promise<ProductionBackupResult> {
  const environment = options.environment ?? process.env;
  const workingDirectory = options.workingDirectory ?? process.cwd();
  const { backupDirectory, databasePath, retentionCount } =
    resolveProductionBackupConfig(environment, workingDirectory);

  const databaseStats = await stat(databasePath).catch(() => undefined);
  if (!databaseStats?.isFile()) {
    throw new ProductionDatabaseSafetyError(
      `Production database does not exist at ${databasePath}; refusing to create an empty backup.`,
    );
  }

  const labelDirectory = join(backupDirectory, options.label);
  await mkdir(labelDirectory, { recursive: true, mode: 0o750 });
  const timestamp = timestampForFile(options.now ?? new Date());
  const backupPath = join(
    labelDirectory,
    `timesince-${options.label}-${timestamp}.sqlite`,
  );
  const temporaryPath = `${backupPath}.partial-${process.pid}`;
  const checksumPath = `${backupPath}.sha256`;
  if (
    (await stat(backupPath).catch(() => undefined)) ||
    (await stat(temporaryPath).catch(() => undefined))
  ) {
    throw new ProductionDatabaseSafetyError(
      `Refusing to overwrite an existing backup path for timestamp ${timestamp}.`,
    );
  }
  const source = new BetterSqlite3(databasePath, {
    fileMustExist: true,
    readonly: true,
  });

  let published = false;
  try {
    await source.backup(temporaryPath);
    await verifySqliteDatabase(temporaryPath);
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, backupPath);
    published = true;
    const checksum = await sha256(backupPath);
    await writeFile(checksumPath, `${checksum}  ${basename(backupPath)}\n`, {
      mode: 0o600,
    });
  } catch (error) {
    await rm(temporaryPath, { force: true });
    if (published) {
      await rm(backupPath, { force: true });
      await rm(checksumPath, { force: true });
    }
    throw error;
  } finally {
    source.close();
  }

  return {
    backupPath,
    checksumPath,
    removedBackups: await removeExpiredBackups(labelDirectory, retentionCount),
  };
}

async function verifyChecksumIfPresent(backupPath: string): Promise<void> {
  const checksumPath = `${backupPath}.sha256`;
  let checksumFile: string;
  try {
    checksumFile = await readFile(checksumPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  const expected = checksumFile.trim().split(/\s+/)[0];
  if (!expected || expected !== (await sha256(backupPath))) {
    throw new ProductionDatabaseSafetyError(
      `Backup checksum verification failed for ${backupPath}.`,
    );
  }
}

export interface ProductionRestoreResult {
  databasePath: string;
  recoveryPaths: string[];
}

export async function restoreProductionBackup(options: {
  backupPath: string;
  confirmDatabasePath: string;
  confirmServiceStopped: boolean;
  environment?: NodeJS.ProcessEnv;
  now?: Date;
  workingDirectory?: string;
}): Promise<ProductionRestoreResult> {
  const environment = options.environment ?? process.env;
  const workingDirectory = options.workingDirectory ?? process.cwd();
  const databasePath = resolveProductionDatabasePath(
    environment,
    workingDirectory,
  );

  if (!options.confirmServiceStopped) {
    throw new ProductionDatabaseSafetyError(
      "Restore requires --confirm-service-stopped after stopping the TimeSince service.",
    );
  }
  if (
    !isAbsolute(options.confirmDatabasePath) ||
    resolve(options.confirmDatabasePath) !== databasePath
  ) {
    throw new ProductionDatabaseSafetyError(
      "--confirm-database must exactly match the configured production DATABASE_PATH.",
    );
  }
  if (!isAbsolute(options.backupPath)) {
    throw new ProductionDatabaseSafetyError(
      "The restore backup path must be absolute.",
    );
  }

  const backupPath = resolve(options.backupPath);
  if (backupPath === databasePath) {
    throw new ProductionDatabaseSafetyError(
      "The restore source must not be the production database itself.",
    );
  }
  const backupStats = await stat(backupPath).catch(() => undefined);
  if (!backupStats?.isFile()) {
    throw new ProductionDatabaseSafetyError(
      `Restore backup does not exist at ${backupPath}.`,
    );
  }

  await verifyChecksumIfPresent(backupPath);
  await verifySqliteDatabase(backupPath);
  await mkdir(dirname(databasePath), { recursive: true, mode: 0o750 });

  const timestamp = timestampForFile(options.now ?? new Date());
  const stagedPath = `${databasePath}.restore-${timestamp}.partial`;
  if (await stat(stagedPath).catch(() => undefined)) {
    throw new ProductionDatabaseSafetyError(
      `Refusing to overwrite existing restore staging file ${stagedPath}.`,
    );
  }
  const source = new BetterSqlite3(backupPath, {
    fileMustExist: true,
    readonly: true,
  });

  try {
    await source.backup(stagedPath);
  } catch (error) {
    await rm(stagedPath, { force: true });
    throw error;
  } finally {
    source.close();
  }

  const recoveryPaths: string[] = [];
  const movedFiles: Array<{ originalPath: string; recoveryPath: string }> = [];
  try {
    await verifySqliteDatabase(stagedPath);
    await chmod(stagedPath, 0o600);

    for (const existingPath of [
      databasePath,
      `${databasePath}-wal`,
      `${databasePath}-shm`,
    ]) {
      const existingStats = await stat(existingPath).catch(() => undefined);
      if (!existingStats) continue;
      const recoveryPath = `${existingPath}.pre-restore-${timestamp}`;
      if (await stat(recoveryPath).catch(() => undefined)) {
        throw new ProductionDatabaseSafetyError(
          `Refusing to overwrite existing recovery file ${recoveryPath}.`,
        );
      }
      await rename(existingPath, recoveryPath);
      recoveryPaths.push(recoveryPath);
      movedFiles.push({ originalPath: existingPath, recoveryPath });
    }

    await rename(stagedPath, databasePath);
  } catch (error) {
    await rm(stagedPath, { force: true });
    for (const { originalPath, recoveryPath } of movedFiles.reverse()) {
      if (!(await stat(originalPath).catch(() => undefined))) {
        await rename(recoveryPath, originalPath);
        recoveryPaths.splice(recoveryPaths.indexOf(recoveryPath), 1);
      }
    }
    throw error;
  }

  return { databasePath, recoveryPaths };
}
