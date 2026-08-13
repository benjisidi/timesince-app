import { resolve } from "node:path";

import express from "express";
import { sql, type Kysely } from "kysely";

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
  app.use("/api", (_request, response, next) => {
    response.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/api/health", async (_request, response) => {
    try {
      await Promise.all([
        sql`select 1 from categories limit 1`.execute(options.database),
        sql`select 1 from tasks limit 1`.execute(options.database),
        sql`select 1 from completions limit 1`.execute(options.database),
      ]);
      const health: HealthResponse = { status: "ok" };
      response.json(health);
    } catch (error) {
      console.error("Health check failed", error);
      const health: HealthResponse = { status: "unavailable" };
      response.status(503).json(health);
    }
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
  app.use(
    "/api/categories",
    createCategoryRouter(options.database, options.clock),
  );

  if (options.clientDirectory) {
    const clientDirectory = resolve(options.clientDirectory);
    app.use(
      "/assets",
      express.static(resolve(clientDirectory, "assets"), {
        immutable: true,
        maxAge: "1y",
      }),
    );
    app.use(
      express.static(clientDirectory, {
        setHeaders(response, filePath) {
          const fileName = filePath.split(/[\\/]/).at(-1);
          if (
            fileName === "index.html" ||
            fileName === "sw.js" ||
            fileName?.endsWith(".webmanifest") ||
            fileName?.startsWith("workbox-")
          ) {
            response.setHeader("Cache-Control", "no-cache");
          }
        },
      }),
    );
    app.use((request, response, next) => {
      if (request.method !== "GET" || request.path.startsWith("/api/")) {
        next();
        return;
      }

      response.setHeader("Cache-Control", "no-cache");
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
