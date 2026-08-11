import { resolve } from "node:path";

import express from "express";
import type { Kysely } from "kysely";

import type { AppConfigResponse } from "../shared/api";
import type { HealthResponse } from "../shared/health";
import { createCategoryRouter } from "./api/categories";
import { apiErrorHandler } from "./api/errors";
import { createCompletionRouter, createTaskRouter } from "./api/tasks";
import type { TimeSinceDatabase } from "./db/types";
import type { Clock } from "./db/repositories/shared";

export interface CreateAppOptions {
  database: Kysely<TimeSinceDatabase>;
  timeZone: string;
  clock?: Clock;
  clientDirectory?: string;
}

function validateTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
  } catch {
    throw new RangeError(`Invalid IANA timezone: ${timeZone}`);
  }
}

export function createApp(options: CreateAppOptions) {
  validateTimeZone(options.timeZone);
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json());

  app.get("/api/health", (_request, response) => {
    const health: HealthResponse = { status: "ok" };
    response.json(health);
  });

  app.get("/api/config", (_request, response) => {
    const config: AppConfigResponse = { timeZone: options.timeZone };
    response.json(config);
  });

  const apiOptions = {
    database: options.database,
    timeZone: options.timeZone,
    ...(options.clock ? { clock: options.clock } : {}),
  };
  app.use("/api/tasks", createTaskRouter(apiOptions));
  app.use("/api/completions", createCompletionRouter(apiOptions));
  app.use("/api/categories", createCategoryRouter(options.database));

  if (options.clientDirectory) {
    const clientDirectory = resolve(options.clientDirectory);
    app.use(express.static(clientDirectory));
    app.use((request, response, next) => {
      if (request.method !== "GET" || request.path.startsWith("/api/")) {
        next();
        return;
      }

      response.sendFile(resolve(clientDirectory, "index.html"));
    });
  }

  app.use((_request, response) => {
    response.status(404).json({
      error: { code: "NOT_FOUND", message: "Route not found" },
    });
  });
  app.use(apiErrorHandler);

  return app;
}
