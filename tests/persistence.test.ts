import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../src/server/db/database";
import { createMigrator } from "../src/server/db/migrator";
import { createCategoryRepository } from "../src/server/db/repositories/categories";
import { createCompletionRepository } from "../src/server/db/repositories/completions";
import { createTaskRepository } from "../src/server/db/repositories/tasks";

const databases = new Set<ReturnType<typeof openDatabase>>();
const temporaryDirectories = new Set<string>();

async function migrate(database: ReturnType<typeof openDatabase>) {
  const result = await createMigrator(database).migrateToLatest();

  if (result.error) {
    throw result.error;
  }
}

async function openMigratedMemoryDatabase() {
  const database = openDatabase({ path: ":memory:" });
  databases.add(database);
  await migrate(database);
  return database;
}

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

describe("category persistence", () => {
  it("trims, creates, reads, orders, and updates categories", async () => {
    const database = await openMigratedMemoryDatabase();
    let now = new Date("2026-08-11T08:00:00.000Z");
    const categories = createCategoryRepository(database, () => now);

    const kitchen = await categories.create({
      name: "  Kitchen  ",
      position: 2,
    });
    const admin = await categories.create({ name: "Admin", position: 1 });

    expect(kitchen).toMatchObject({
      name: "Kitchen",
      position: 2,
      createdAt: "2026-08-11T08:00:00.000Z",
    });
    expect(await categories.getById(kitchen.id)).toEqual(kitchen);
    expect((await categories.list()).map(({ name }) => name)).toEqual([
      "Admin",
      "Kitchen",
    ]);

    now = new Date("2026-08-11T09:00:00.000Z");
    const updated = await categories.update(admin.id, {
      name: "  Paperwork ",
      position: 3,
    });

    expect(updated).toMatchObject({
      name: "Paperwork",
      position: 3,
      updatedAt: "2026-08-11T09:00:00.000Z",
    });
  });

  it("rejects blank and case-insensitively duplicate names", async () => {
    const database = await openMigratedMemoryDatabase();
    const categories = createCategoryRepository(database);

    await expect(
      categories.create({ name: "  ", position: 0 }),
    ).rejects.toThrow("Category name must not be blank");

    await categories.create({ name: "Kitchen", position: 0 });
    await expect(
      categories.create({ name: "kItChEn", position: 1 }),
    ).rejects.toThrow();
  });
});

describe("task persistence", () => {
  it("creates tasks with or without a category and edits active tasks", async () => {
    const database = await openMigratedMemoryDatabase();
    let now = new Date("2026-08-11T08:00:00.000Z");
    const categories = createCategoryRepository(database, () => now);
    const tasks = createTaskRepository(database, () => now);
    const category = await categories.create({ name: "Kitchen", position: 0 });

    const categorized = await tasks.create({
      name: "Clean fridge",
      categoryId: category.id,
      targetIntervalDays: 30,
    });
    const uncategorized = await tasks.create({
      name: "Renew documents",
      targetIntervalDays: 180,
    });

    expect(categorized.categoryId).toBe(category.id);
    expect(uncategorized.categoryId).toBeNull();

    now = new Date("2026-08-11T10:00:00.000Z");
    const updated = await tasks.update(categorized.id, {
      name: "Deep-clean fridge",
      categoryId: null,
      targetIntervalDays: 45,
      snoozedUntil: new Date("2026-08-15T08:00:00.000Z"),
    });

    expect(updated).toMatchObject({
      name: "Deep-clean fridge",
      categoryId: null,
      targetIntervalDays: 45,
      snoozedUntil: "2026-08-15T08:00:00.000Z",
      updatedAt: "2026-08-11T10:00:00.000Z",
    });
  });

  it("enforces category references and interval constraints", async () => {
    const database = await openMigratedMemoryDatabase();
    const tasks = createTaskRepository(database);

    await expect(
      tasks.create({
        name: "Invalid category",
        categoryId: 999,
        targetIntervalDays: 1,
      }),
    ).rejects.toThrow();
    await expect(
      tasks.create({ name: "Invalid interval", targetIntervalDays: 0 }),
    ).rejects.toThrow();
  });

  it("archives idempotently, excludes archives by default, and keeps history", async () => {
    const database = await openMigratedMemoryDatabase();
    let now = new Date("2026-08-11T08:00:00.000Z");
    const tasks = createTaskRepository(database, () => now);
    const completions = createCompletionRepository(database, () => now);
    const task = await tasks.create({
      name: "Wash curtains",
      targetIntervalDays: 90,
    });
    await completions.create({ taskId: task.id });

    now = new Date("2026-08-11T09:00:00.000Z");
    const archived = await tasks.archive(task.id);
    now = new Date("2026-08-11T10:00:00.000Z");
    const archivedAgain = await tasks.archive(task.id);

    expect(archived?.archivedAt).toBe("2026-08-11T09:00:00.000Z");
    expect(archivedAgain?.archivedAt).toBe(archived?.archivedAt);
    expect(await tasks.getById(task.id)).toBeUndefined();
    expect(await tasks.list()).toEqual([]);
    expect(await tasks.getById(task.id, { includeArchived: true })).toEqual(
      archived,
    );
    expect(await completions.listForTask(task.id)).toHaveLength(1);

    now = new Date("2026-08-11T11:00:00.000Z");
    const restored = await tasks.restore(task.id);
    expect(restored).toMatchObject({
      archivedAt: null,
      updatedAt: "2026-08-11T11:00:00.000Z",
    });
    expect(await tasks.getById(task.id)).toEqual(restored);
    expect(await completions.listForTask(task.id)).toHaveLength(1);
  });
});

describe("completion persistence", () => {
  it("preserves ordered history, retrieves the latest, and removes an exact event", async () => {
    const database = await openMigratedMemoryDatabase();
    const tasks = createTaskRepository(database);
    const completions = createCompletionRepository(
      database,
      () => new Date("2026-08-11T12:00:00.000Z"),
    );
    const task = await tasks.create({
      name: "Descale kettle",
      targetIntervalDays: 30,
    });
    const oldest = await completions.create({
      taskId: task.id,
      completedAt: new Date("2026-06-01T08:00:00.000Z"),
    });
    const tiedFirst = await completions.create({
      taskId: task.id,
      completedAt: new Date("2026-07-01T08:00:00.000Z"),
    });
    const tiedSecond = await completions.create({
      taskId: task.id,
      completedAt: new Date("2026-07-01T08:00:00.000Z"),
    });

    expect(
      (await completions.listForTask(task.id)).map(({ id }) => id),
    ).toEqual([tiedSecond.id, tiedFirst.id, oldest.id]);
    expect(await completions.getLatestForTask(task.id)).toEqual(tiedSecond);
    expect(await completions.remove(tiedFirst.id)).toEqual(tiedFirst);
    expect(
      (await completions.listForTask(task.id)).map(({ id }) => id),
    ).toEqual([tiedSecond.id, oldest.id]);
    expect(await completions.remove(tiedFirst.id)).toBeUndefined();
  });

  it("rejects invalid task references and protects task history", async () => {
    const database = await openMigratedMemoryDatabase();
    const tasks = createTaskRepository(database);
    const completions = createCompletionRepository(database);
    const task = await tasks.create({
      name: "Clean oven",
      targetIntervalDays: 60,
    });

    await expect(completions.create({ taskId: 999 })).rejects.toThrow();
    await completions.create({ taskId: task.id });
    await expect(
      database.deleteFrom("tasks").where("id", "=", task.id).execute(),
    ).rejects.toThrow();
  });
});

describe("category deletion", () => {
  it("makes tasks uncategorized without deleting tasks or completions", async () => {
    const database = await openMigratedMemoryDatabase();
    let now = new Date("2026-08-11T08:00:00.000Z");
    const categories = createCategoryRepository(database, () => now);
    const tasks = createTaskRepository(database, () => now);
    const completions = createCompletionRepository(database, () => now);
    const category = await categories.create({ name: "Garden", position: 0 });
    const task = await tasks.create({
      name: "Oil tools",
      categoryId: category.id,
      targetIntervalDays: 120,
    });
    await completions.create({ taskId: task.id });

    now = new Date("2026-08-11T09:00:00.000Z");
    expect(await categories.remove(category.id)).toBe(true);

    expect(await categories.getById(category.id)).toBeUndefined();
    expect(await categories.remove(category.id)).toBe(false);
    expect(await tasks.getById(task.id)).toMatchObject({
      categoryId: null,
      updatedAt: "2026-08-11T09:00:00.000Z",
    });
    expect(await completions.listForTask(task.id)).toHaveLength(1);
  });
});

describe("file persistence", () => {
  it("survives closing and reopening the database", async () => {
    const directory = await mkdtemp(join(tmpdir(), "timesince-test-"));
    temporaryDirectories.add(directory);
    const path = join(directory, "timesince.sqlite");

    const firstDatabase = openDatabase({ path });
    await migrate(firstDatabase);
    const firstCategories = createCategoryRepository(firstDatabase);
    const category = await firstCategories.create({
      name: "Bedroom",
      position: 0,
    });
    await firstDatabase.destroy();

    const reopenedDatabase = openDatabase({ path });
    databases.add(reopenedDatabase);
    await migrate(reopenedDatabase);
    const reopenedCategories = createCategoryRepository(reopenedDatabase);

    expect(await reopenedCategories.getById(category.id)).toEqual(category);
  });
});
