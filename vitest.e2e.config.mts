import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// End-to-end: runs the production build (`next start`) against real Postgres with a stubbed OpenAI.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["e2e/**/*.e2e.test.ts"],
    globalSetup: ["e2e/global-setup.ts"],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 90_000,
  },
});
