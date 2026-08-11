import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/server/app";
import { openDatabase } from "../src/server/db/database";

const databases = new Set<ReturnType<typeof openDatabase>>();
const temporaryDirectories = new Set<string>();

afterEach(async () => {
  await Promise.all([
    ...[...databases].map((database) => database.destroy()),
    ...[...temporaryDirectories].map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  ]);
  databases.clear();
  temporaryDirectories.clear();
});

describe("GET /api/health", () => {
  it("reports that the backend is available", async () => {
    const database = openDatabase({ path: ":memory:" });
    databases.add(database);
    const response = await request(
      createApp({ database, timeZone: "Europe/London" }),
    ).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("rejects an invalid deployment timezone when creating the app", () => {
    const database = openDatabase({ path: ":memory:" });
    databases.add(database);

    expect(() => createApp({ database, timeZone: "Not/A_Time_Zone" })).toThrow(
      "Invalid IANA timezone",
    );
  });

  it("serves the production SPA for direct history-based routes", async () => {
    const database = openDatabase({ path: ":memory:" });
    databases.add(database);
    const clientDirectory = await mkdtemp(join(tmpdir(), "timesince-client-"));
    temporaryDirectories.add(clientDirectory);
    await writeFile(
      join(clientDirectory, "index.html"),
      "<!doctype html><title>TimeSince test client</title>",
    );

    const app = createApp({
      clientDirectory,
      database,
      timeZone: "Europe/London",
    });
    for (const path of ["/categories", "/categories/manage"]) {
      const response = await request(app).get(path);
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toMatch(/^text\/html/);
      expect(response.text).toContain("TimeSince test client");
    }
  });
});
