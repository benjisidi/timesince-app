import { Router } from "express";
import type { Kysely } from "kysely";

import type { CategoryListResponse, CategoryResponse } from "../../shared/api";
import type { TimeSinceDatabase } from "../db/types";
import {
  createCategoryRepository,
  type CategoryWithActiveTaskCount,
} from "../db/repositories/categories";
import type { Clock } from "../db/repositories/shared";
import { ApiError } from "./errors";
import {
  parseCreateCategoryBody,
  parseId,
  parseReorderCategoriesBody,
  parseReplacementCategoryQuery,
  parseUpdateCategoryBody,
} from "./validation";

function isCategoryNameConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}

function conflict(error: unknown): never {
  if (isCategoryNameConflict(error)) {
    throw new ApiError(
      409,
      "CATEGORY_NAME_CONFLICT",
      "A category with that name already exists",
      { name: "Choose a different category name" },
    );
  }
  throw error;
}

function toResponse(category: CategoryWithActiveTaskCount): CategoryResponse {
  return {
    id: category.id,
    name: category.name,
    position: category.position,
    activeTaskCount: category.activeTaskCount,
  };
}

export function createCategoryRouter(
  database: Kysely<TimeSinceDatabase>,
  clock?: Clock,
) {
  const router = Router();
  const categories = createCategoryRepository(database, clock);

  async function listResponse(): Promise<CategoryListResponse> {
    return {
      categories: (await categories.listWithActiveTaskCounts()).map(toResponse),
    };
  }

  router.get("/", async (_request, response) => {
    response.json(await listResponse());
  });

  router.post("/", async (request, response) => {
    const input = parseCreateCategoryBody(request.body);
    try {
      const created = await categories.createAtEnd(input.name);
      const result = (await categories.listWithActiveTaskCounts()).find(
        ({ id }) => id === created.id,
      );
      response.status(201).json(toResponse(result!));
    } catch (error) {
      conflict(error);
    }
  });

  router.put("/order", async (request, response) => {
    const input = parseReorderCategoriesBody(request.body);
    if (!(await categories.reorder(input.categoryIds))) {
      throw new ApiError(
        400,
        "INVALID_CATEGORY_ORDER",
        "Category order must include every category exactly once",
        { categoryIds: "Refresh the categories and try again" },
      );
    }
    response.json(await listResponse());
  });

  router.patch("/:categoryId", async (request, response) => {
    const categoryId = parseId(request.params.categoryId, "categoryId");
    const input = parseUpdateCategoryBody(request.body);
    try {
      if (!(await categories.update(categoryId, { name: input.name }))) {
        throw new ApiError(404, "CATEGORY_NOT_FOUND", "Category not found");
      }
      const result = (await categories.listWithActiveTaskCounts()).find(
        ({ id }) => id === categoryId,
      );
      response.json(toResponse(result!));
    } catch (error) {
      conflict(error);
    }
  });

  router.delete("/:categoryId", async (request, response) => {
    const categoryId = parseId(request.params.categoryId, "categoryId");
    const replacementCategoryId = parseReplacementCategoryQuery(
      request.query.replacementCategoryId,
    );
    try {
      if (!(await categories.remove(categoryId, replacementCategoryId))) {
        throw new ApiError(404, "CATEGORY_NOT_FOUND", "Category not found");
      }
      response.json(await listResponse());
    } catch (error) {
      if (error instanceof RangeError) {
        throw new ApiError(400, "INVALID_REPLACEMENT_CATEGORY", error.message, {
          replacementCategoryId: error.message,
        });
      }
      throw error;
    }
  });

  return router;
}
