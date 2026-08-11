import type { Kysely, Selectable, Updateable } from "kysely";

import type { TaskTable, TimeSinceDatabase } from "../types";
import { systemClock, toIsoTimestamp, type Clock } from "./shared";

export interface TaskRecord {
  id: number;
  name: string;
  categoryId: number | null;
  targetIntervalDays: number;
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface CreateTaskInput {
  name: string;
  categoryId?: number | null;
  targetIntervalDays: number;
  snoozedUntil?: Date | null;
}

export interface UpdateTaskInput {
  name?: string;
  categoryId?: number | null;
  targetIntervalDays?: number;
  snoozedUntil?: Date | null;
}

export interface TaskReadOptions {
  includeArchived?: boolean;
}

function toTaskRecord(task: Selectable<TaskTable>): TaskRecord {
  return {
    id: task.id,
    name: task.name,
    categoryId: task.category_id,
    targetIntervalDays: task.target_interval_days,
    snoozedUntil: task.snoozed_until,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    archivedAt: task.archived_at,
  };
}

export function createTaskRepository(
  database: Kysely<TimeSinceDatabase>,
  clock: Clock = systemClock,
) {
  return {
    async create(input: CreateTaskInput): Promise<TaskRecord> {
      const timestamp = toIsoTimestamp(clock());
      const task = await database
        .insertInto("tasks")
        .values({
          name: input.name,
          category_id: input.categoryId ?? null,
          target_interval_days: input.targetIntervalDays,
          snoozed_until:
            input.snoozedUntil === undefined || input.snoozedUntil === null
              ? null
              : toIsoTimestamp(input.snoozedUntil),
          created_at: timestamp,
          updated_at: timestamp,
          archived_at: null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return toTaskRecord(task);
    },

    async getById(
      id: number,
      options: TaskReadOptions = {},
    ): Promise<TaskRecord | undefined> {
      let query = database.selectFrom("tasks").selectAll().where("id", "=", id);

      if (!options.includeArchived) {
        query = query.where("archived_at", "is", null);
      }

      const task = await query.executeTakeFirst();
      return task ? toTaskRecord(task) : undefined;
    },

    async list(options: TaskReadOptions = {}): Promise<TaskRecord[]> {
      let query = database.selectFrom("tasks").selectAll();

      if (!options.includeArchived) {
        query = query.where("archived_at", "is", null);
      }

      const tasks = await query
        .orderBy("created_at", "asc")
        .orderBy("id", "asc")
        .execute();

      return tasks.map(toTaskRecord);
    },

    async update(
      id: number,
      input: UpdateTaskInput,
    ): Promise<TaskRecord | undefined> {
      const update: Updateable<TaskTable> = {
        updated_at: toIsoTimestamp(clock()),
      };

      if (input.name !== undefined) {
        update.name = input.name;
      }

      if (input.categoryId !== undefined) {
        update.category_id = input.categoryId;
      }

      if (input.targetIntervalDays !== undefined) {
        update.target_interval_days = input.targetIntervalDays;
      }

      if (input.snoozedUntil !== undefined) {
        update.snoozed_until =
          input.snoozedUntil === null
            ? null
            : toIsoTimestamp(input.snoozedUntil);
      }

      const task = await database
        .updateTable("tasks")
        .set(update)
        .where("id", "=", id)
        .where("archived_at", "is", null)
        .returningAll()
        .executeTakeFirst();

      return task ? toTaskRecord(task) : undefined;
    },

    async archive(id: number): Promise<TaskRecord | undefined> {
      const timestamp = toIsoTimestamp(clock());
      const archived = await database
        .updateTable("tasks")
        .set({ archived_at: timestamp, updated_at: timestamp })
        .where("id", "=", id)
        .where("archived_at", "is", null)
        .returningAll()
        .executeTakeFirst();

      if (archived) {
        return toTaskRecord(archived);
      }

      const existing = await database
        .selectFrom("tasks")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();

      return existing ? toTaskRecord(existing) : undefined;
    },

    async restore(id: number): Promise<TaskRecord | undefined> {
      const timestamp = toIsoTimestamp(clock());
      const restored = await database
        .updateTable("tasks")
        .set({ archived_at: null, updated_at: timestamp })
        .where("id", "=", id)
        .where("archived_at", "is not", null)
        .returningAll()
        .executeTakeFirst();

      if (restored) {
        return toTaskRecord(restored);
      }

      const existing = await database
        .selectFrom("tasks")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();

      return existing ? toTaskRecord(existing) : undefined;
    },
  };
}
