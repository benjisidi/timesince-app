import { resolve } from "node:path";

import express from "express";

import type { HealthResponse } from "../shared/health";

export interface CreateAppOptions {
  clientDirectory?: string;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json());

  app.get("/api/health", (_request, response) => {
    const health: HealthResponse = { status: "ok" };
    response.json(health);
  });

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
    response.status(404).json({ error: "Not found" });
  });

  return app;
}
