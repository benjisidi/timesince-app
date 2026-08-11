import type { Migration } from "kysely/migration";

import { initialSchema } from "./001_initial_schema";

export const migrations: Readonly<Record<string, Migration>> = {
  "001_initial_schema": initialSchema,
};
