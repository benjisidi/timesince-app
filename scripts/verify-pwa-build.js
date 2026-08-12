import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath, URL } from "node:url";

const clientUrl = new URL("../dist/client/", import.meta.url);
const clientDirectory = fileURLToPath(clientUrl);

function assert(condition, message) {
  if (!condition) throw new Error(`PWA build verification failed: ${message}`);
}

async function readClientFile(path, encoding) {
  return readFile(new URL(path, clientUrl), encoding);
}

const [indexHtml, manifestText, serviceWorker, outputFiles] = await Promise.all(
  [
    readClientFile("index.html", "utf8"),
    readClientFile("manifest.webmanifest", "utf8"),
    readClientFile("sw.js", "utf8"),
    readdir(clientDirectory),
  ],
);
const manifest = JSON.parse(manifestText);

assert(indexHtml.includes('rel="manifest"'), "index.html has no manifest link");
assert(manifest.id === "/", "manifest id must remain root-scoped");
assert(manifest.start_url === "/", "manifest start_url must be /");
assert(manifest.scope === "/", "manifest scope must be /");
assert(manifest.display === "standalone", "manifest must use standalone mode");

for (const [size, purpose] of [
  ["192x192", "any"],
  ["512x512", "any"],
  ["192x192", "maskable"],
  ["512x512", "maskable"],
]) {
  assert(
    manifest.icons?.some(
      (icon) => icon.sizes === size && icon.purpose === purpose,
    ),
    `manifest is missing the ${size} ${purpose} icon`,
  );
}

assert(
  serviceWorker.includes("api(?:\\/|$)"),
  "service-worker navigation fallback does not exclude /api",
);
assert(
  outputFiles.some(
    (file) => file.startsWith("workbox-") && file.endsWith(".js"),
  ),
  "Workbox runtime was not emitted",
);
