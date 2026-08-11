import { fileURLToPath } from "node:url";

import { createApp } from "./app";
import { openDatabase } from "./db/database";

const defaultPort = process.env.NODE_ENV === "production" ? 3000 : 3001;
const port = Number.parseInt(process.env.PORT ?? String(defaultPort), 10);
const clientDirectory = fileURLToPath(new URL("../client", import.meta.url));
const timeZone = process.env.TIME_ZONE;

if (!timeZone) {
  throw new Error("TIME_ZONE must be set to an IANA timezone");
}

const database = openDatabase();
const app = createApp(
  process.env.NODE_ENV === "production"
    ? { clientDirectory, database, timeZone }
    : { database, timeZone },
);

app.listen(port, "127.0.0.1", () => {
  console.log(`TimeSince is listening on http://127.0.0.1:${port}`);
});
