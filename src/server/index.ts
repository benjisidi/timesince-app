import { fileURLToPath } from "node:url";

import { createApp } from "./app";
import { ConfigurationError, readServerConfig } from "./config";
import { openDatabase } from "./db/database";

const clientDirectory = fileURLToPath(new URL("../client", import.meta.url));

try {
  const config = readServerConfig();
  const database = openDatabase({ path: config.databasePath });
  const app = createApp(
    config.isProduction
      ? { clientDirectory, database, timeZone: config.timeZone }
      : { database, timeZone: config.timeZone },
  );

  app.listen(config.port, "127.0.0.1", () => {
    console.log(`TimeSince is listening on http://127.0.0.1:${config.port}`);
  });
} catch (error) {
  if (error instanceof ConfigurationError) {
    console.error(`Configuration error: ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
