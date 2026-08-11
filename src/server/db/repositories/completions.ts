import type { Kysely, Selectable } from "kysely";

import type { CompletionTable, TimeSinceDatabase } from "../types";
import { systemClock, toIsoTimestamp, type Clock } from "./shared";

export interface CompletionRecord {
  id: number;
  taskId: number;
  completedAt: string;
  createdAt: string;
}

export interface CreateCompletionInput {
  taskId: number;
  completedAt?: Date;
}

function toCompletionRecord(
  completion: Selectable<CompletionTable>,
): CompletionRecord {
  return {
    id: completion.id,
    taskId: completion.task_id,
    completedAt: completion.completed_at,
    createdAt: completion.created_at,
  };
}

export function createCompletionRepository(
  database: Kysely<TimeSinceDatabase>,
  clock: Clock = systemClock,
) {
  return {
    async create(input: CreateCompletionInput): Promise<CompletionRecord> {
      const now = clock();
      const completion = await database
        .insertInto("completions")
        .values({
          task_id: input.taskId,
          completed_at: toIsoTimestamp(input.completedAt ?? now),
          created_at: toIsoTimestamp(now),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return toCompletionRecord(completion);
    },

    async listForTask(taskId: number): Promise<CompletionRecord[]> {
      const completions = await database
        .selectFrom("completions")
        .selectAll()
        .where("task_id", "=", taskId)
        .orderBy("completed_at", "desc")
        .orderBy("id", "desc")
        .execute();

      return completions.map(toCompletionRecord);
    },

    async getLatestForTask(
      taskId: number,
    ): Promise<CompletionRecord | undefined> {
      const completion = await database
        .selectFrom("completions")
        .selectAll()
        .where("task_id", "=", taskId)
        .orderBy("completed_at", "desc")
        .orderBy("id", "desc")
        .executeTakeFirst();

      return completion ? toCompletionRecord(completion) : undefined;
    },

    async remove(id: number): Promise<CompletionRecord | undefined> {
      const completion = await database
        .deleteFrom("completions")
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();

      return completion ? toCompletionRecord(completion) : undefined;
    },
  };
}
