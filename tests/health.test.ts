import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/server/app";
import { openDatabase } from "../src/server/db/database";

const databases = new Set<ReturnType<typeof openDatabase>>();

afterEach(async () => {
  await Promise.all([...databases].map((database) => database.destroy()));
  databases.clear();
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
});
