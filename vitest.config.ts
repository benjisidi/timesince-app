import { defineConfig } from "vitest/config";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [VitePWA({ devOptions: { enabled: false } })],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/client/**/*.test.tsx"],
  },
});
