import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../src/server/db/database";
import { createMigrator } from "../src/server/db/migrator";

const databases = new Set<ReturnType<typeof openDatabase>>();

async function openMigratedDatabase() {
  const database = openDatabase({ path: ":memory:" });
  databases.add(database);

  const result = await createMigrator(database).migrateToLatest();
  expect(result.error).toBeUndefined();

  return database;
}

afterEach(async () => {
  await Promise.all([...databases].map((database) => database.destroy()));
  databases.clear();
});

describe("database foundation", () => {
  it("opens SQLite with foreign-key enforcement enabled", async () => {
    const database = openDatabase({ path: ":memory:" });
    databases.add(database);

    const result = await sql<{
      foreign_keys: number;
    }>`PRAGMA foreign_keys`.execute(database);

    expect(result.rows[0]?.foreign_keys).toBe(1);
  });

  it("creates the complete schema from migrations", async () => {
    const database = await openMigratedDatabase();
    const tables = await sql<{ name: string }>`
      select name
      from sqlite_master
      where type = 'table' and name in ('categories', 'tasks', 'completions')
      order by name
    `.execute(database);
    const indexes = await sql<{ name: string }>`
      select name
      from sqlite_master
      where type = 'index' and name in (
        'categories_name_nocase_unique',
        'tasks_category_id_index',
        'completions_task_completed_at_index'
      )
      order by name
    `.execute(database);

    expect(tables.rows.map(({ name }) => name)).toEqual([
      "categories",
      "completions",
      "tasks",
    ]);
    expect(indexes.rows.map(({ name }) => name)).toEqual([
      "categories_name_nocase_unique",
      "completions_task_completed_at_index",
      "tasks_category_id_index",
    ]);
  });

  it("enforces nonblank category names and positive task intervals", async () => {
    const database = await openMigratedDatabase();

    await expect(
      database
        .insertInto("categories")
        .values({
          name: "   ",
          position: 0,
          created_at: "2026-08-11T08:00:00.000Z",
          updated_at: "2026-08-11T08:00:00.000Z",
        })
        .execute(),
    ).rejects.toThrow();

    await expect(
      database
        .insertInto("tasks")
        .values({
          name: "Invalid task",
          category_id: null,
          target_interval_days: 0,
          snoozed_until: null,
          created_at: "2026-08-11T08:00:00.000Z",
          updated_at: "2026-08-11T08:00:00.000Z",
          archived_at: null,
        })
        .execute(),
    ).rejects.toThrow();
  });
});
