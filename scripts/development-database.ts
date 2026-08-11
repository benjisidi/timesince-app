import { existsSync, rmSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

import type { Kysely } from "kysely";

import { defaultDatabasePath } from "../src/server/db/database";
import { createCategoryRepository } from "../src/server/db/repositories/categories";
import { createCompletionRepository } from "../src/server/db/repositories/completions";
import { createTaskRepository } from "../src/server/db/repositories/tasks";
import type { TimeSinceDatabase } from "../src/server/db/types";

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

export class DevelopmentDatabaseSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevelopmentDatabaseSafetyError";
  }
}

export interface SeedResult {
  categoryCount: number;
  fixtureNow: Date;
  taskCount: number;
}

export function resolveDevelopmentDatabasePath(
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
): string {
  if (environment.NODE_ENV?.trim().toLowerCase() === "production") {
    throw new DevelopmentDatabaseSafetyError(
      "Refusing to modify fixtures while NODE_ENV=production.",
    );
  }

  const databasePath = resolve(
    workingDirectory,
    environment.DATABASE_PATH?.trim() || defaultDatabasePath(workingDirectory),
  );
  const developmentDataDirectory = resolve(workingDirectory, "data");
  const relativePath = relative(developmentDataDirectory, databasePath);

  if (
    relativePath === "" ||
    relativePath.startsWith("..") ||
    isAbsolute(relativePath)
  ) {
    throw new DevelopmentDatabaseSafetyError(
      `Refusing to modify ${databasePath}. Development fixture databases must be inside ${developmentDataDirectory}.`,
    );
  }

  return databasePath;
}

export function resetDevelopmentDatabase(
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
): { databasePath: string; removedFiles: string[] } {
  const databasePath = resolveDevelopmentDatabasePath(
    environment,
    workingDirectory,
  );
  const databaseFiles = [
    databasePath,
    `${databasePath}-shm`,
    `${databasePath}-wal`,
  ];
  const removedFiles: string[] = [];

  for (const file of databaseFiles) {
    if (existsSync(file)) {
      rmSync(file, { force: true });
      removedFiles.push(file);
    }
  }

  return { databasePath, removedFiles };
}

export function fixtureReferenceTime(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function daysFrom(reference: Date, dayOffset: number): Date {
  return new Date(reference.getTime() + dayOffset * MILLISECONDS_PER_DAY);
}

export async function seedDevelopmentDatabase(
  database: Kysely<TimeSinceDatabase>,
  fixtureNow = fixtureReferenceTime(),
): Promise<SeedResult> {
  const [categoryCount, taskCount, completionCount] = await Promise.all([
    database
      .selectFrom("categories")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow(),
    database
      .selectFrom("tasks")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow(),
    database
      .selectFrom("completions")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .executeTakeFirstOrThrow(),
  ]);

  if (
    Number(categoryCount.count) !== 0 ||
    Number(taskCount.count) !== 0 ||
    Number(completionCount.count) !== 0
  ) {
    throw new Error(
      "Development seed requires an empty task database. Run npm run db:fixtures:dev instead.",
    );
  }

  await database.transaction().execute(async (transaction) => {
    const clock = () => fixtureNow;
    const categories = createCategoryRepository(transaction, clock);
    const tasks = createTaskRepository(transaction, clock);
    const completions = createCompletionRepository(transaction, clock);

    const kitchen = await categories.create({ name: "Kitchen", position: 0 });
    const bedroom = await categories.create({ name: "Bedroom", position: 1 });
    const outdoors = await categories.create({
      name: "Outdoor spaces and seasonal maintenance",
      position: 2,
    });

    await tasks.create({
      name: "Replace smoke alarm batteries",
      categoryId: bedroom.id,
      targetIntervalDays: 180,
    });

    const overTarget = await tasks.create({
      name: "Descale kettle",
      categoryId: kitchen.id,
      targetIntervalDays: 7,
    });
    await completions.create({
      taskId: overTarget.id,
      completedAt: daysFrom(fixtureNow, -19),
    });

    const sleeping = await tasks.create({
      name: "Change bedsheets",
      categoryId: bedroom.id,
      targetIntervalDays: 14,
    });
    await completions.create({
      taskId: sleeping.id,
      completedAt: daysFrom(fixtureNow, -3),
    });

    const snoozed = await tasks.create({
      name: "Clean oven",
      categoryId: kitchen.id,
      targetIntervalDays: 7,
      snoozedUntil: daysFrom(fixtureNow, 7),
    });
    await completions.create({
      taskId: snoozed.id,
      completedAt: daysFrom(fixtureNow, -30),
    });

    const uncategorized = await tasks.create({
      name: "Review household paperwork",
      targetIntervalDays: 30,
    });
    await completions.create({
      taskId: uncategorized.id,
      completedAt: daysFrom(fixtureNow, -45),
    });

    const longName = await tasks.create({
      name: "Clear leaves and debris from the narrow path beside the garden storage shed",
      categoryId: outdoors.id,
      targetIntervalDays: 30,
    });
    await completions.create({
      taskId: longName.id,
      completedAt: daysFrom(fixtureNow, -5),
    });

    const readyAtTarget = await tasks.create({
      name: "Water balcony plants",
      categoryId: outdoors.id,
      targetIntervalDays: 7,
    });
    await completions.create({
      taskId: readyAtTarget.id,
      completedAt: daysFrom(fixtureNow, -7),
    });
  });

  return { categoryCount: 3, fixtureNow, taskCount: 7 };
}
