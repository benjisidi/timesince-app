import { Router } from "express";
import type { Kysely } from "kysely";

import type { CategoryListResponse } from "../../shared/api";
import type { TimeSinceDatabase } from "../db/types";
import { createCategoryRepository } from "../db/repositories/categories";

export function createCategoryRouter(database: Kysely<TimeSinceDatabase>) {
  const router = Router();
  const categories = createCategoryRepository(database);

  router.get("/", async (_request, response) => {
    const body: CategoryListResponse = {
      categories: (await categories.list()).map(({ id, name, position }) => ({
        id,
        name,
        position,
      })),
    };
    response.json(body);
  });

  return router;
}
