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

  const server = app.listen(config.port, "127.0.0.1", () => {
    console.log(`TimeSince is listening on http://127.0.0.1:${config.port}`);
  });

  let shuttingDown = false;
  function shutDown(signal: NodeJS.Signals) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down TimeSince.`);

    const forceCloseTimer = setTimeout(() => {
      console.error("Graceful shutdown timed out; closing open connections.");
      server.closeAllConnections();
    }, 10_000);
    forceCloseTimer.unref();

    server.close((serverError) => {
      clearTimeout(forceCloseTimer);
      void database
        .destroy()
        .catch((databaseError: unknown) => {
          console.error("Failed to close the database cleanly", databaseError);
          process.exitCode = 1;
        })
        .finally(() => {
          if (serverError) {
            console.error(
              "Failed to close the HTTP server cleanly",
              serverError,
            );
            process.exitCode = 1;
          }
        });
    });
  }

  process.once("SIGINT", shutDown);
  process.once("SIGTERM", shutDown);
} catch (error) {
  if (error instanceof ConfigurationError) {
    console.error(`Configuration error: ${error.message}`);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
