import type { Kysely, Selectable, Updateable } from "kysely";

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

    async list(): Promise<CategoryRecord[]> {
      const categories = await database
        .selectFrom("categories")
        .selectAll()
        .orderBy("position", "asc")
        .orderBy("id", "asc")
        .execute();

      return categories.map(toCategoryRecord);
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

    async remove(id: number): Promise<boolean> {
      return database.transaction().execute(async (transaction) => {
        const category = await transaction
          .selectFrom("categories")
          .select("id")
          .where("id", "=", id)
          .executeTakeFirst();

        if (!category) {
          return false;
        }

        await transaction
          .updateTable("tasks")
          .set({
            category_id: null,
            updated_at: toIsoTimestamp(clock()),
          })
          .where("category_id", "=", id)
          .execute();

        await transaction
          .deleteFrom("categories")
          .where("id", "=", id)
          .executeTakeFirst();

        return true;
      });
    },
  };
}
