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
        DATABASE_PATH: "data/custom.sqlite",
        NODE_ENV: "production",
        PORT: "4100",
        TIME_ZONE: "America/New_York",
      }),
    ).toEqual({
      databasePath: "data/custom.sqlite",
      isProduction: true,
      port: 4100,
      timeZone: "America/New_York",
    });

    expect(() =>
      readServerConfig({ PORT: "invalid", TIME_ZONE: "Europe/London" }),
    ).toThrow("PORT must be a whole number between 1 and 65535");
  });
});
