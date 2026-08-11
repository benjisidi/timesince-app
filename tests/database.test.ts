import { sql } from "kysely";
import { afterEach, describe, expect, it } from "vitest";

import { openDatabase } from "../src/server/db/database";
import { createMigrator } from "../src/server/db/migrator";

const databases = new Set<ReturnType<typeof openDatabase>>();

afterEach(async () => {
  await Promise.all([...databases].map((database) => database.destroy()));
  databases.clear();
});

describe("database foundation", () => {
  it("opens SQLite with foreign-key enforcement enabled", async () => {
    const database = openDatabase({ path: ":memory:" });
    databases.add(database);

    const result = await sql<{
      foreign_keys: number;
    }>`PRAGMA foreign_keys`.execute(database);

    expect(result.rows[0]?.foreign_keys).toBe(1);
  });

  it("runs the empty migration set successfully", async () => {
    const database = openDatabase({ path: ":memory:" });
    databases.add(database);

    const result = await createMigrator(database).migrateToLatest();

    expect(result.error).toBeUndefined();
    expect(result.results).toEqual([]);
  });
});
