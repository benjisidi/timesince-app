import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  resolveDevelopmentDatabasePath,
  seedDevelopmentDatabase,
} from "../scripts/development-database";
import { deriveTaskState } from "../src/shared/task-state";
import { openDatabase } from "../src/server/db/database";
import { createMigrator } from "../src/server/db/migrator";
import { createCategoryRepository } from "../src/server/db/repositories/categories";
import { createCompletionRepository } from "../src/server/db/repositories/completions";
import { createTaskRepository } from "../src/server/db/repositories/tasks";

const databases = new Set<ReturnType<typeof openDatabase>>();

afterEach(async () => {
  await Promise.all([...databases].map((database) => database.destroy()));
  databases.clear();
});

describe("development database fixtures", () => {
  it("refuses production and database paths outside the checkout data directory", () => {
    const workingDirectory = resolve("fixture-safety-test");

    expect(() =>
      resolveDevelopmentDatabasePath(
        { NODE_ENV: "production" },
        workingDirectory,
      ),
    ).toThrow("NODE_ENV=production");
    expect(() =>
      resolveDevelopmentDatabasePath(
        { DATABASE_PATH: "../production.sqlite" },
        workingDirectory,
      ),
    ).toThrow("must be inside");
    expect(
      resolveDevelopmentDatabasePath(
        { DATABASE_PATH: "data/manual-qa.sqlite" },
        workingDirectory,
      ),
    ).toBe(resolve(workingDirectory, "data", "manual-qa.sqlite"));
  });

  it("seeds representative task states and category shapes", async () => {
    const database = openDatabase({ path: ":memory:" });
    databases.add(database);
    const migration = await createMigrator(database).migrateToLatest();
    expect(migration.error).toBeUndefined();

    const fixtureNow = new Date("2026-08-11T00:00:00.000Z");
    await seedDevelopmentDatabase(database, fixtureNow);

    const categories = await createCategoryRepository(database).list();
    const tasks = await createTaskRepository(database).list();
    const latestCompletions = await createCompletionRepository(
      database,
    ).getLatestForTasks(tasks.map(({ id }) => id));
    const taskByName = new Map(tasks.map((task) => [task.name, task]));

    function stateFor(name: string) {
      const task = taskByName.get(name);
      expect(task).toBeDefined();
      const latest = latestCompletions.get(task!.id);
      return deriveTaskState({
        completionTimestamps: latest ? [new Date(latest)] : [],
        now: fixtureNow,
        snoozedUntil: task!.snoozedUntil ? new Date(task!.snoozedUntil) : null,
        targetIntervalDays: task!.targetIntervalDays,
        timeZone: "UTC",
      });
    }

    expect(categories.map(({ name }) => name)).toEqual([
      "Kitchen",
      "Bedroom",
      "Outdoor spaces and seasonal maintenance",
    ]);
    expect(tasks).toHaveLength(7);
    expect(stateFor("Replace smoke alarm batteries")).toMatchObject({
      elapsedDays: null,
      state: "ready",
    });
    expect(stateFor("Descale kettle")).toMatchObject({
      overageDays: 12,
      state: "ready",
    });
    expect(stateFor("Change bedsheets")).toMatchObject({
      elapsedDays: 3,
      state: "sleeping",
    });
    expect(stateFor("Clean oven")).toMatchObject({
      isSnoozed: true,
      state: "ready",
      visibleInReady: false,
    });
    expect(taskByName.get("Review household paperwork")?.categoryId).toBeNull();
    expect(
      taskByName.get(
        "Clear leaves and debris from the narrow path beside the garden storage shed",
      )?.name.length,
    ).toBeGreaterThan(60);
    expect(new Set(tasks.map(({ categoryId }) => categoryId))).toEqual(
      new Set([null, ...categories.map(({ id }) => id)]),
    );
  });
});
