import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/server/app";

describe("GET /api/health", () => {
  it("reports that the backend is available", async () => {
    const response = await request(createApp()).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});
