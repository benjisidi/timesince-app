import { dirname, isAbsolute, relative, resolve } from "node:path";

export class ProductionDatabaseSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionDatabaseSafetyError";
  }
}

function isWithin(parent: string, candidate: string): boolean {
  const relativePath = relative(parent, candidate);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function requireProductionEnvironment(environment: NodeJS.ProcessEnv): void {
  if (environment.NODE_ENV?.trim().toLowerCase() !== "production") {
    throw new ProductionDatabaseSafetyError(
      "Production database operations require NODE_ENV=production.",
    );
  }
}

function requireAbsolutePath(
  value: string | undefined,
  variableName: string,
): string {
  const path = value?.trim();
  if (!path) {
    throw new ProductionDatabaseSafetyError(
      `${variableName} must be set explicitly for production.`,
    );
  }
  if (!isAbsolute(path)) {
    throw new ProductionDatabaseSafetyError(
      `${variableName} must be an absolute path in production.`,
    );
  }
  return resolve(path);
}

export function resolveProductionDatabasePath(
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
): string {
  requireProductionEnvironment(environment);
  const databasePath = requireAbsolutePath(
    environment.DATABASE_PATH,
    "DATABASE_PATH",
  );
  const applicationDirectory = resolve(workingDirectory);

  if (isWithin(applicationDirectory, databasePath)) {
    throw new ProductionDatabaseSafetyError(
      `DATABASE_PATH must be outside the application release directory (${applicationDirectory}).`,
    );
  }

  return databasePath;
}

export interface ProductionBackupConfig {
  backupDirectory: string;
  databasePath: string;
  retentionCount: number;
}

export function resolveProductionBackupConfig(
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
): ProductionBackupConfig {
  const databasePath = resolveProductionDatabasePath(
    environment,
    workingDirectory,
  );
  const backupDirectory = requireAbsolutePath(
    environment.BACKUP_DIRECTORY,
    "BACKUP_DIRECTORY",
  );
  const applicationDirectory = resolve(workingDirectory);

  if (isWithin(applicationDirectory, backupDirectory)) {
    throw new ProductionDatabaseSafetyError(
      `BACKUP_DIRECTORY must be outside the application release directory (${applicationDirectory}).`,
    );
  }
  if (backupDirectory === dirname(databasePath)) {
    throw new ProductionDatabaseSafetyError(
      "BACKUP_DIRECTORY must not be the production database directory.",
    );
  }

  const retentionValue = environment.BACKUP_RETENTION_COUNT?.trim() || "30";
  const retentionCount = Number(retentionValue);
  if (
    !Number.isInteger(retentionCount) ||
    retentionCount < 1 ||
    retentionCount > 365
  ) {
    throw new ProductionDatabaseSafetyError(
      "BACKUP_RETENTION_COUNT must be a whole number between 1 and 365.",
    );
  }

  return { backupDirectory, databasePath, retentionCount };
}

export interface OffsiteBackupConfig {
  backupPath: string;
  backupDirectory: string;
  configPath?: string;
  destination: string;
  rcloneBinary: string;
  remote: string;
}

export function resolveOffsiteBackupConfig(
  environment: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
): OffsiteBackupConfig {
  const { backupDirectory } = resolveProductionBackupConfig(
    environment,
    workingDirectory,
  );
  const remote = environment.RCLONE_REMOTE?.trim();

  if (!remote || remote.startsWith("-") || /[/:\r\n]/.test(remote)) {
    throw new ProductionDatabaseSafetyError(
      "RCLONE_REMOTE must name a configured rclone remote without a colon or path, for example gdrive.",
    );
  }

  const backupPathValue = environment.RCLONE_BACKUP_PATH?.trim();
  const backupPathSegments = backupPathValue?.split("/") ?? [];
  if (
    !backupPathValue ||
    backupPathValue.startsWith("/") ||
    backupPathValue.startsWith("-") ||
    /[:\r\n]/.test(backupPathValue) ||
    backupPathSegments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new ProductionDatabaseSafetyError(
      "RCLONE_BACKUP_PATH must be a non-empty relative remote path without dot segments, for example TimeSince/backups.",
    );
  }

  const rcloneBinary = environment.RCLONE_BINARY?.trim() || "rclone";
  if (
    !rcloneBinary ||
    rcloneBinary.startsWith("-") ||
    /[\r\n]/.test(rcloneBinary) ||
    (rcloneBinary.includes("/") && !isAbsolute(rcloneBinary))
  ) {
    throw new ProductionDatabaseSafetyError(
      "RCLONE_BINARY must be a command name or absolute executable path.",
    );
  }

  const configuredPath = environment.RCLONE_CONFIG?.trim();
  let configPath: string | undefined;
  if (configuredPath) {
    if (!isAbsolute(configuredPath)) {
      throw new ProductionDatabaseSafetyError(
        "RCLONE_CONFIG must be an absolute path when set.",
      );
    }
    configPath = resolve(configuredPath);
  }

  return {
    backupDirectory,
    backupPath: backupPathValue,
    destination: `${remote}:${backupPathValue}`,
    rcloneBinary,
    remote,
    ...(configPath ? { configPath } : {}),
  };
}
