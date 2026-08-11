import { sql, type Kysely, type Selectable, type Updateable } from "kysely";

import type { CategoryTable, TimeSinceDatabase } from "../types";
import {
  normalizeCategoryName,
  systemClock,
  toIsoTimestamp,
  type Clock,
} from "./shared";

export interface CategoryRecord {
  id: number;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryWithActiveTaskCount extends CategoryRecord {
  activeTaskCount: number;
}

export interface CreateCategoryInput {
  name: string;
  position: number;
}

export interface UpdateCategoryInput {
  name?: string;
  position?: number;
}

function toCategoryRecord(category: Selectable<CategoryTable>): CategoryRecord {
  return {
    id: category.id,
    name: category.name,
    position: category.position,
    createdAt: category.created_at,
    updatedAt: category.updated_at,
  };
}

export function createCategoryRepository(
  database: Kysely<TimeSinceDatabase>,
  clock: Clock = systemClock,
) {
  return {
    async create(input: CreateCategoryInput): Promise<CategoryRecord> {
      const timestamp = toIsoTimestamp(clock());
      const category = await database
        .insertInto("categories")
        .values({
          name: normalizeCategoryName(input.name),
          position: input.position,
          created_at: timestamp,
          updated_at: timestamp,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return toCategoryRecord(category);
    },

    async getById(id: number): Promise<CategoryRecord | undefined> {
      const category = await database
        .selectFrom("categories")
        .selectAll()
        .where("id", "=", id)
        .executeTakeFirst();

      return category ? toCategoryRecord(category) : undefined;
    },

    async createAtEnd(name: string): Promise<CategoryRecord> {
      return database.transaction().execute(async (transaction) => {
        const lastCategory = await transaction
          .selectFrom("categories")
          .select("position")
          .orderBy("position", "desc")
          .orderBy("id", "desc")
          .executeTakeFirst();
        const timestamp = toIsoTimestamp(clock());
        const category = await transaction
          .insertInto("categories")
          .values({
            name: normalizeCategoryName(name),
            position: (lastCategory?.position ?? -1) + 1,
            created_at: timestamp,
            updated_at: timestamp,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        return toCategoryRecord(category);
      });
    },

    async list(): Promise<CategoryRecord[]> {
      const categories = await database
        .selectFrom("categories")
        .selectAll()
        .orderBy("position", "asc")
        .orderBy("id", "asc")
        .execute();

      return categories.map(toCategoryRecord);
    },

    async listWithActiveTaskCounts(): Promise<CategoryWithActiveTaskCount[]> {
      const categories = await database
        .selectFrom("categories")
        .leftJoin("tasks", (join) =>
          join
            .onRef("tasks.category_id", "=", "categories.id")
            .on("tasks.archived_at", "is", null),
        )
        .select([
          "categories.id",
          "categories.name",
          "categories.position",
          "categories.created_at",
          "categories.updated_at",
          sql<number>`cast(count(tasks.id) as integer)`.as("active_task_count"),
        ])
        .groupBy("categories.id")
        .orderBy("categories.position", "asc")
        .orderBy("categories.id", "asc")
        .execute();

      return categories.map((category) => ({
        id: category.id,
        name: category.name,
        position: category.position,
        createdAt: category.created_at,
        updatedAt: category.updated_at,
        activeTaskCount: category.active_task_count,
      }));
    },

    async update(
      id: number,
      input: UpdateCategoryInput,
    ): Promise<CategoryRecord | undefined> {
      const update: Updateable<CategoryTable> = {
        updated_at: toIsoTimestamp(clock()),
      };

      if (input.name !== undefined) {
        update.name = normalizeCategoryName(input.name);
      }

      if (input.position !== undefined) {
        update.position = input.position;
      }

      const category = await database
        .updateTable("categories")
        .set(update)
        .where("id", "=", id)
        .returningAll()
        .executeTakeFirst();

      return category ? toCategoryRecord(category) : undefined;
    },

    async reorder(categoryIds: number[]): Promise<boolean> {
      return database.transaction().execute(async (transaction) => {
        const existing = await transaction
          .selectFrom("categories")
          .select("id")
          .execute();
        const existingIds = new Set(existing.map(({ id }) => id));
        if (
          existingIds.size !== categoryIds.length ||
          categoryIds.some((id) => !existingIds.has(id))
        ) {
          return false;
        }

        const timestamp = toIsoTimestamp(clock());
        for (const [position, id] of categoryIds.entries()) {
          await transaction
            .updateTable("categories")
            .set({ position, updated_at: timestamp })
            .where("id", "=", id)
            .execute();
        }
        return true;
      });
    },

    async remove(
      id: number,
      replacementCategoryId: number | null = null,
    ): Promise<boolean> {
      return database.transaction().execute(async (transaction) => {
        const category = await transaction
          .selectFrom("categories")
          .select("id")
          .where("id", "=", id)
          .executeTakeFirst();

        if (!category) {
          return false;
        }

        if (replacementCategoryId === id) {
          throw new RangeError("Replacement category must be different");
        }
        if (replacementCategoryId !== null) {
          const replacement = await transaction
            .selectFrom("categories")
            .select("id")
            .where("id", "=", replacementCategoryId)
            .executeTakeFirst();
          if (!replacement) {
            throw new RangeError("Replacement category does not exist");
          }
        }

        const timestamp = toIsoTimestamp(clock());

        await transaction
          .updateTable("tasks")
          .set({
            category_id: replacementCategoryId,
            updated_at: timestamp,
          })
          .where("category_id", "=", id)
          .execute();

        await transaction
          .deleteFrom("categories")
          .where("id", "=", id)
          .executeTakeFirst();

        const remaining = await transaction
          .selectFrom("categories")
          .select(["id", "position"])
          .orderBy("position", "asc")
          .orderBy("id", "asc")
          .execute();
        for (const [position, item] of remaining.entries()) {
          if (item.position !== position) {
            await transaction
              .updateTable("categories")
              .set({ position, updated_at: timestamp })
              .where("id", "=", item.id)
              .execute();
          }
        }

        return true;
      });
    },
  };
}
