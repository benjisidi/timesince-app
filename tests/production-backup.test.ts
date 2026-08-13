import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../src/server/db/database";
import { createMigrator } from "../src/server/db/migrator";
import {
  createProductionBackup,
  restoreProductionBackup,
  verifySqliteDatabase,
} from "../src/server/db/production-backup";
import {
  resolveOffsiteBackupConfig,
  resolveProductionBackupConfig,
  resolveProductionDatabasePath,
} from "../src/server/db/production-config";
import { createCategoryRepository } from "../src/server/db/repositories/categories";

const temporaryDirectories = new Set<string>();
const databases = new Set<ReturnType<typeof openDatabase>>();

afterEach(async () => {
  await Promise.all([...databases].map((database) => database.destroy()));
  databases.clear();
  await Promise.all(
    [...temporaryDirectories].map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
  temporaryDirectories.clear();
});

async function productionEnvironment(retentionCount = 30) {
  const directory = await mkdtemp(join(tmpdir(), "timesince-production-"));
  temporaryDirectories.add(directory);
  return {
    directory,
    environment: {
      BACKUP_DIRECTORY: join(directory, "backups"),
      BACKUP_RETENTION_COUNT: String(retentionCount),
      DATABASE_PATH: join(directory, "data", "timesince.sqlite"),
      NODE_ENV: "production",
      RCLONE_BACKUP_PATH: "TimeSince/backups",
      RCLONE_REMOTE: "gdrive",
    },
  };
}

async function openMigratedDatabase(path: string) {
  const database = openDatabase({ path });
  databases.add(database);
  const migration = await createMigrator(database).migrateToLatest();
  if (migration.error) throw migration.error;
  return database;
}

describe("production database safeguards", () => {
  it("requires explicit production mode and external absolute paths", async () => {
    const { directory, environment } = await productionEnvironment();

    expect(() =>
      resolveProductionDatabasePath({
        DATABASE_PATH: environment.DATABASE_PATH,
      }),
    ).toThrow("NODE_ENV=production");
    expect(() =>
      resolveProductionDatabasePath({
        DATABASE_PATH: "data/timesince.sqlite",
        NODE_ENV: "production",
      }),
    ).toThrow("absolute path");
    expect(() =>
      resolveProductionDatabasePath(
        {
          DATABASE_PATH: join(directory, "release", "data.sqlite"),
          NODE_ENV: "production",
        },
        join(directory, "release"),
      ),
    ).toThrow("outside the application release");

    expect(resolveProductionBackupConfig(environment)).toMatchObject({
      backupDirectory: environment.BACKUP_DIRECTORY,
      databasePath: environment.DATABASE_PATH,
      retentionCount: 30,
    });
    expect(resolveOffsiteBackupConfig(environment)).toMatchObject({
      backupPath: environment.RCLONE_BACKUP_PATH,
      destination: "gdrive:TimeSince/backups",
      remote: environment.RCLONE_REMOTE,
    });
  });

  it("rejects unsafe rclone remote paths and relative config files", async () => {
    const { environment } = await productionEnvironment();
    expect(() =>
      resolveOffsiteBackupConfig({
        ...environment,
        RCLONE_BACKUP_PATH: "../backups",
      }),
    ).toThrow("RCLONE_BACKUP_PATH");
    expect(() =>
      resolveOffsiteBackupConfig({
        ...environment,
        RCLONE_CONFIG: "rclone.conf",
      }),
    ).toThrow("RCLONE_CONFIG must be an absolute path");
  });
});

describe("production backup and restore", () => {
  it("creates verified live backups, applies retention, and restores state", async () => {
    const { environment } = await productionEnvironment(2);
    const database = await openMigratedDatabase(environment.DATABASE_PATH);
    const categories = createCategoryRepository(database);
    await categories.create({ name: "Before backup", position: 0 });

    const first = await createProductionBackup({
      environment,
      label: "daily",
      now: new Date("2026-08-10T03:15:00.000Z"),
    });
    const second = await createProductionBackup({
      environment,
      label: "daily",
      now: new Date("2026-08-11T03:15:00.000Z"),
    });
    const third = await createProductionBackup({
      environment,
      label: "daily",
      now: new Date("2026-08-12T03:15:00.000Z"),
    });

    expect(third.removedBackups).toEqual([first.backupPath]);
    await expect(stat(first.backupPath)).rejects.toThrow();
    await expect(stat(second.backupPath)).resolves.toBeTruthy();
    await verifySqliteDatabase(third.backupPath);
    expect(await readFile(third.checksumPath, "utf8")).toContain(
      "timesince-daily-",
    );

    await categories.create({ name: "After backup", position: 1 });
    await database.destroy();
    databases.delete(database);

    await expect(
      restoreProductionBackup({
        backupPath: third.backupPath,
        confirmDatabasePath: environment.DATABASE_PATH,
        confirmServiceStopped: false,
        environment,
      }),
    ).rejects.toThrow("--confirm-service-stopped");

    const restored = await restoreProductionBackup({
      backupPath: third.backupPath,
      confirmDatabasePath: environment.DATABASE_PATH,
      confirmServiceStopped: true,
      environment,
      now: new Date("2026-08-12T12:00:00.000Z"),
    });
    expect(restored.recoveryPaths).toHaveLength(1);

    const reopened = openDatabase({ path: environment.DATABASE_PATH });
    databases.add(reopened);
    expect(
      (await createCategoryRepository(reopened).list()).map(({ name }) => name),
    ).toEqual(["Before backup"]);
  });

  it("refuses to back up a missing production database", async () => {
    const { environment } = await productionEnvironment();
    await expect(
      createProductionBackup({ environment, label: "manual" }),
    ).rejects.toThrow("refusing to create an empty backup");
  });
});
