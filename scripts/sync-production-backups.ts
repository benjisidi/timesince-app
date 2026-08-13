import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveOffsiteBackupConfig } from "../src/server/db/production-config";

export type CommandRunner = (
  binary: string,
  arguments_: string[],
) => Promise<void>;

export function runCommand(
  binary: string,
  arguments_: string[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, arguments_, { stdio: "inherit" });
    child.once("error", (error) => {
      reject(new Error(`Could not start rclone (${binary}): ${error.message}`));
    });
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            signal
              ? `rclone was terminated by ${signal}.`
              : `rclone exited with status ${String(code)}.`,
          ),
        );
      }
    });
  });
}

export async function syncProductionBackups(
  options: {
    environment?: NodeJS.ProcessEnv;
    run?: CommandRunner;
    workingDirectory?: string;
  } = {},
): Promise<{ destination: string }> {
  const { backupDirectory, configPath, destination, rcloneBinary } =
    resolveOffsiteBackupConfig(options.environment, options.workingDirectory);
  const arguments_ = ["copy", backupDirectory, destination];
  if (configPath) arguments_.push("--config", configPath);

  await (options.run ?? runCommand)(rcloneBinary, arguments_);
  return { destination };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const { destination } = await syncProductionBackups();
    console.log(`Production backups copied off-host to ${destination}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Off-host backup sync failed: ${message}`);
    process.exitCode = 1;
  }
}
