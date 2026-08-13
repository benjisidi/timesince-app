import { rm } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

import { build } from "esbuild";

const outputDirectory = fileURLToPath(
  new URL("./dist/server/", import.meta.url),
);

await rm(outputDirectory, { force: true, recursive: true });

await build({
  bundle: true,
  entryPoints: {
    backup: "scripts/backup-production.ts",
    index: "src/server/index.ts",
    migrate: "scripts/migrate.ts",
    restore: "scripts/restore-production.ts",
    "sync-backups": "scripts/sync-production-backups.ts",
  },
  format: "esm",
  outdir: outputDirectory,
  packages: "external",
  platform: "node",
  sourcemap: true,
  target: "node22",
});
