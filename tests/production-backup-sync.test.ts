import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { syncProductionBackups } from "../scripts/sync-production-backups";

const workingDirectory = "/opt/timesince/releases/test-release";

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    BACKUP_DIRECTORY: "/var/backups/timesince",
    DATABASE_PATH: "/var/lib/timesince/timesince.sqlite",
    NODE_ENV: "production",
    RCLONE_BACKUP_PATH: "TimeSince/backups",
    RCLONE_BINARY: "/usr/bin/rclone",
    RCLONE_CONFIG: "/var/lib/timesince/rclone/rclone.conf",
    RCLONE_REMOTE: "gdrive",
    ...overrides,
  };
}

describe("production off-host backup sync", () => {
  it("invokes rclone copy without deletion propagation", async () => {
    const run = vi.fn().mockResolvedValue(undefined);

    await expect(
      syncProductionBackups({
        environment: environment(),
        run,
        workingDirectory,
      }),
    ).resolves.toEqual({ destination: "gdrive:TimeSince/backups" });

    expect(run).toHaveBeenCalledWith("/usr/bin/rclone", [
      "copy",
      "/var/backups/timesince",
      "gdrive:TimeSince/backups",
      "--config",
      "/var/lib/timesince/rclone/rclone.conf",
    ]);
    expect(run.mock.calls[0]?.[1]).not.toContain("sync");
    expect(run.mock.calls[0]?.[1]).not.toContain("--delete-during");
  });

  it("rejects when rclone fails so callers remain fail-closed", async () => {
    const run = vi
      .fn()
      .mockRejectedValue(new Error("rclone exited with status 5."));

    await expect(
      syncProductionBackups({
        environment: environment(),
        run,
        workingDirectory,
      }),
    ).rejects.toThrow("rclone exited with status 5");
  });

  it("rejects missing rclone configuration before starting a process", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const missingRemote = environment();
    delete missingRemote.RCLONE_REMOTE;

    await expect(
      syncProductionBackups({
        environment: missingRemote,
        run,
        workingDirectory: resolve(workingDirectory),
      }),
    ).rejects.toThrow("RCLONE_REMOTE");
    expect(run).not.toHaveBeenCalled();

    const missingPath = environment();
    delete missingPath.RCLONE_BACKUP_PATH;
    await expect(
      syncProductionBackups({
        environment: missingPath,
        run,
        workingDirectory,
      }),
    ).rejects.toThrow("RCLONE_BACKUP_PATH");
    expect(run).not.toHaveBeenCalled();
  });
});
