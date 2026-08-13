import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ConfigurationError, readServerConfig } from "../src/server/config";

describe("server configuration", () => {
  it("requires an explicit valid timezone with actionable errors", () => {
    expect(() => readServerConfig({})).toThrowError(
      new ConfigurationError(
        "TIME_ZONE is required. Set it in .env (see .env.example) or the environment.",
      ),
    );
    expect(() => readServerConfig({ TIME_ZONE: "Not/AZone" })).toThrow(
      "TIME_ZONE must be a valid IANA timezone",
    );
  });

  it("uses development defaults for optional settings", () => {
    expect(readServerConfig({ TIME_ZONE: "Europe/London" })).toEqual({
      databasePath: resolve("data", "timesince.sqlite"),
      isProduction: false,
      port: 3001,
      timeZone: "Europe/London",
    });
  });

  it("uses production defaults and accepts optional overrides", () => {
    expect(
      readServerConfig({
        DATABASE_PATH: "/var/lib/timesince/custom.sqlite",
        NODE_ENV: "production",
        PORT: "4100",
        TIME_ZONE: "America/New_York",
      }),
    ).toEqual({
      databasePath: "/var/lib/timesince/custom.sqlite",
      isProduction: true,
      port: 4100,
      timeZone: "America/New_York",
    });

    expect(() =>
      readServerConfig({ PORT: "invalid", TIME_ZONE: "Europe/London" }),
    ).toThrow("PORT must be a whole number between 1 and 65535");
  });

  it("requires an explicit absolute external production database path", () => {
    expect(() =>
      readServerConfig({
        NODE_ENV: "production",
        TIME_ZONE: "Europe/London",
      }),
    ).toThrow("DATABASE_PATH must be set explicitly for production");
    expect(() =>
      readServerConfig({
        DATABASE_PATH: "data/timesince.sqlite",
        NODE_ENV: "production",
        TIME_ZONE: "Europe/London",
      }),
    ).toThrow("DATABASE_PATH must be an absolute path in production");
    expect(() =>
      readServerConfig({
        DATABASE_PATH: resolve("data/timesince.sqlite"),
        NODE_ENV: "production",
        TIME_ZONE: "Europe/London",
      }),
    ).toThrow("DATABASE_PATH must be outside the application release");
  });
});
