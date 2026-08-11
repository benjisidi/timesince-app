import { Router } from "express";
import type { Kysely } from "kysely";

import type {
  CompletionListResponse,
  CompletionMutationResponse,
  TaskListResponse,
  TaskResponse,
} from "../../shared/api";
import { deriveTaskState } from "../../shared/task-state";
import type { TimeSinceDatabase } from "../db/types";
import { createCategoryRepository } from "../db/repositories/categories";
import {
  createCompletionRepository,
  type CompletionRecord,
} from "../db/repositories/completions";
import { systemClock, type Clock } from "../db/repositories/shared";
import {
  createTaskRepository,
  type TaskRecord,
} from "../db/repositories/tasks";
import { ApiError } from "./errors";
import {
  assertEmptyBody,
  parseBooleanQuery,
  parseCategoryQuery,
  parseCreateCompletionBody,
  parseCreateTaskBody,
  parseId,
  parseStateQuery,
  parseUpdateTaskBody,
} from "./validation";

export interface CreateTaskRouterOptions {
  database: Kysely<TimeSinceDatabase>;
  timeZone: string;
  clock?: Clock;
}

function notFound(resource: "Task" | "Completion"): never {
  throw new ApiError(
    404,
    `${resource.toUpperCase()}_NOT_FOUND`,
    `${resource} not found`,
  );
}

function taskArchived(): never {
  throw new ApiError(
    409,
    "TASK_ARCHIVED",
    "Archived tasks are read-only until restored",
  );
}

function taskNotArchived(): never {
  throw new ApiError(409, "TASK_NOT_ARCHIVED", "Task is already active");
}

function parseStoredTimestamp(value: string | null): Date | null {
  if (value === null) {
    return null;
  }

  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error("Persisted timestamp is invalid");
  }
  return timestamp;
}

function mapTaskResponse(
  task: TaskRecord,
  category: { id: number; name: string } | null,
  latestCompletedAt: string | undefined,
  now: Date,
  timeZone: string,
): TaskResponse {
  const derived = deriveTaskState({
    completionTimestamps: latestCompletedAt
      ? [parseStoredTimestamp(latestCompletedAt) as Date]
      : [],
    targetIntervalDays: task.targetIntervalDays,
    snoozedUntil: parseStoredTimestamp(task.snoozedUntil),
    now,
    timeZone,
  });

  return {
    id: task.id,
    name: task.name,
    category,
    targetIntervalDays: task.targetIntervalDays,
    snoozedUntil: task.snoozedUntil,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    archivedAt: task.archivedAt,
    lastCompletedAt: derived.lastCompletedAt?.toISOString() ?? null,
    elapsedDays: derived.elapsedDays,
    overageDays: derived.overageDays,
    state: derived.state,
    isSnoozed: derived.isSnoozed,
    visibleInReady: task.archivedAt === null && derived.visibleInReady,
  };
}

function compareByNameAndId(first: TaskResponse, second: TaskResponse) {
  return first.name.localeCompare(second.name) || first.id - second.id;
}

function compareReady(first: TaskResponse, second: TaskResponse) {
  if (first.elapsedDays === null && second.elapsedDays !== null) {
    return -1;
  }
  if (first.elapsedDays !== null && second.elapsedDays === null) {
    return 1;
  }

  const elapsedDifference =
    (second.elapsedDays ?? 0) - (first.elapsedDays ?? 0);
  return elapsedDifference || compareByNameAndId(first, second);
}

function compareSleeping(first: TaskResponse, second: TaskResponse) {
  const elapsedDifference =
    (second.elapsedDays ?? 0) - (first.elapsedDays ?? 0);
  return elapsedDifference || compareByNameAndId(first, second);
}

function toCompletionResponse(completion: CompletionRecord) {
  return { ...completion };
}

export function createTaskRouter(options: CreateTaskRouterOptions) {
  const router = Router();
  const clock = options.clock ?? systemClock;
  const tasks = createTaskRepository(options.database, clock);
  const completions = createCompletionRepository(options.database, clock);
  const categories = createCategoryRepository(options.database, clock);

  async function ensureCategoryExists(categoryId: number | null) {
    if (categoryId !== null && !(await categories.getById(categoryId))) {
      throw new ApiError(400, "INVALID_CATEGORY", "Category does not exist", {
        categoryId: "Category does not exist",
      });
    }
  }

  async function getExistingTask(id: number): Promise<TaskRecord> {
    const task = await tasks.getById(id, { includeArchived: true });
    return task ?? notFound("Task");
  }

  async function getActiveTask(id: number): Promise<TaskRecord> {
    const task = await getExistingTask(id);
    if (task.archivedAt !== null) {
      return taskArchived();
    }
    return task;
  }

  async function createTaskResponse(
    task: TaskRecord,
    now: Date,
  ): Promise<TaskResponse> {
    const [category, latestCompletion] = await Promise.all([
      task.categoryId === null
        ? Promise.resolve(undefined)
        : categories.getById(task.categoryId),
      completions.getLatestForTask(task.id),
    ]);

    return mapTaskResponse(
      task,
      category ? { id: category.id, name: category.name } : null,
      latestCompletion?.completedAt,
      now,
      options.timeZone,
    );
  }

  router.get("/", async (request, response) => {
    const now = clock();
    const includeArchived =
      parseBooleanQuery(request.query.includeArchived, "includeArchived") ??
      false;
    const categoryId = parseCategoryQuery(request.query.categoryId);
    const state = parseStateQuery(request.query.state);
    const visibleInReady = parseBooleanQuery(
      request.query.visibleInReady,
      "visibleInReady",
    );
    let records = await tasks.list({ includeArchived });

    if (categoryId !== undefined) {
      records = records.filter((task) => task.categoryId === categoryId);
    }

    const [categoryRecords, latestCompletions] = await Promise.all([
      categories.list(),
      completions.getLatestForTasks(records.map((task) => task.id)),
    ]);
    const categoryById = new Map(
      categoryRecords.map((category) => [
        category.id,
        { id: category.id, name: category.name },
      ]),
    );
    let taskResponses = records.map((task) =>
      mapTaskResponse(
        task,
        task.categoryId === null
          ? null
          : (categoryById.get(task.categoryId) ?? null),
        latestCompletions.get(task.id),
        now,
        options.timeZone,
      ),
    );

    if (state !== "all") {
      taskResponses = taskResponses.filter((task) => task.state === state);
    }
    if (visibleInReady !== undefined) {
      taskResponses = taskResponses.filter(
        (task) => task.visibleInReady === visibleInReady,
      );
    }
    if (state === "ready") {
      taskResponses.sort(compareReady);
    } else if (state === "sleeping") {
      taskResponses.sort(compareSleeping);
    }

    const body: TaskListResponse = { tasks: taskResponses };
    response.json(body);
  });

  router.post("/", async (request, response) => {
    const now = clock();
    const input = parseCreateTaskBody(request.body, now, options.timeZone);
    await ensureCategoryExists(input.categoryId);

    const task = await options.database
      .transaction()
      .execute(async (transaction) => {
        const transactionTasks = createTaskRepository(transaction, clock);
        const created = await transactionTasks.create({
          name: input.name,
          categoryId: input.categoryId,
          targetIntervalDays: input.targetIntervalDays,
        });

        if (input.initialCompletedAt !== null) {
          const transactionCompletions = createCompletionRepository(
            transaction,
            clock,
          );
          await transactionCompletions.create({
            taskId: created.id,
            completedAt: input.initialCompletedAt,
          });
        }

        return created;
      });

    response.status(201).json(await createTaskResponse(task, now));
  });

  router.get("/:taskId", async (request, response) => {
    const now = clock();
    const task = await getExistingTask(
      parseId(request.params.taskId, "taskId"),
    );
    response.json(await createTaskResponse(task, now));
  });

  router.patch("/:taskId", async (request, response) => {
    const now = clock();
    const taskId = parseId(request.params.taskId, "taskId");
    await getActiveTask(taskId);
    const input = parseUpdateTaskBody(request.body, now, options.timeZone);
    if (input.categoryId !== undefined) {
      await ensureCategoryExists(input.categoryId);
    }

    const task = await tasks.update(taskId, input);
    response.json(await createTaskResponse(task ?? notFound("Task"), now));
  });

  router.delete("/:taskId", async (request, response) => {
    const taskId = parseId(request.params.taskId, "taskId");
    await getActiveTask(taskId);
    const task = await tasks.archive(taskId);
    if (!task) {
      notFound("Task");
    }
    response.status(204).send();
  });

  router.post("/:taskId/restore", async (request, response) => {
    const now = clock();
    const taskId = parseId(request.params.taskId, "taskId");
    assertEmptyBody(request.body);
    const existing = await getExistingTask(taskId);
    if (existing.archivedAt === null) {
      taskNotArchived();
    }
    const task = await tasks.restore(taskId);
    response.json(await createTaskResponse(task ?? notFound("Task"), now));
  });

  router.get("/:taskId/completions", async (request, response) => {
    const taskId = parseId(request.params.taskId, "taskId");
    await getExistingTask(taskId);
    const body: CompletionListResponse = {
      completions: (await completions.listForTask(taskId)).map(
        toCompletionResponse,
      ),
    };
    response.json(body);
  });

  router.post("/:taskId/completions", async (request, response) => {
    const now = clock();
    const taskId = parseId(request.params.taskId, "taskId");
    await getActiveTask(taskId);
    const input = parseCreateCompletionBody(request.body, now);
    const completion = await completions.create({
      taskId,
      completedAt: input.completedAt ?? now,
    });
    const task = await getActiveTask(taskId);
    const body: CompletionMutationResponse = {
      completion: toCompletionResponse(completion),
      task: await createTaskResponse(task, now),
    };
    response.status(201).json(body);
  });

  return router;
}

export function createCompletionRouter(options: CreateTaskRouterOptions) {
  const router = Router();
  const clock = options.clock ?? systemClock;
  const tasks = createTaskRepository(options.database, clock);
  const completions = createCompletionRepository(options.database, clock);
  const categories = createCategoryRepository(options.database, clock);

  router.delete("/:completionId", async (request, response) => {
    const now = clock();
    const completionId = parseId(request.params.completionId, "completionId");
    const existing = await completions.getById(completionId);
    if (!existing) {
      notFound("Completion");
    }

    const task = await tasks.getById(existing.taskId, {
      includeArchived: true,
    });
    if (!task) {
      notFound("Task");
    }
    if (task.archivedAt !== null) {
      taskArchived();
    }

    const removed = await completions.remove(completionId);
    if (!removed) {
      notFound("Completion");
    }
    const latest = await completions.getLatestForTask(task.id);
    const category =
      task.categoryId === null
        ? undefined
        : await categories.getById(task.categoryId);
    const body: CompletionMutationResponse = {
      completion: toCompletionResponse(removed),
      task: mapTaskResponse(
        task,
        category ? { id: category.id, name: category.name } : null,
        latest?.completedAt,
        now,
        options.timeZone,
      ),
    };
    response.json(body);
  });

  return router;
}
