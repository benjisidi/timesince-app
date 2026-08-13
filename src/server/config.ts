import { defaultDatabasePath } from "./db/database";
import {
  ProductionDatabaseSafetyError,
  resolveProductionDatabasePath,
} from "./db/production-config";

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export interface ServerConfig {
  databasePath: string;
  isProduction: boolean;
  port: number;
  timeZone: string;
}

function parsePort(value: string | undefined, defaultPort: number): number {
  if (value === undefined || value.trim() === "") {
    return defaultPort;
  }

  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new ConfigurationError(
      "PORT must be a whole number between 1 and 65535.",
    );
  }

  return port;
}

function parseTimeZone(value: string | undefined): string {
  const timeZone = value?.trim();
  if (!timeZone) {
    throw new ConfigurationError(
      "TIME_ZONE is required. Set it in .env (see .env.example) or the environment.",
    );
  }

  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
  } catch {
    throw new ConfigurationError(
      "TIME_ZONE must be a valid IANA timezone, for example Europe/London.",
    );
  }

  return timeZone;
}

export function readServerConfig(
  environment: NodeJS.ProcessEnv = process.env,
): ServerConfig {
  const isProduction =
    environment.NODE_ENV?.trim().toLowerCase() === "production";
  const defaultPort = isProduction ? 3000 : 3001;
  const configuredDatabasePath = environment.DATABASE_PATH?.trim();

  let databasePath: string;
  try {
    databasePath = isProduction
      ? resolveProductionDatabasePath(environment)
      : configuredDatabasePath || defaultDatabasePath();
  } catch (error) {
    if (error instanceof ProductionDatabaseSafetyError) {
      throw new ConfigurationError(error.message);
    }
    throw error;
  }

  return {
    databasePath,
    isProduction,
    port: parsePort(environment.PORT, defaultPort),
    timeZone: parseTimeZone(environment.TIME_ZONE),
  };
}
