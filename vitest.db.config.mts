import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Integration tests against real Postgres; RUN_DB_TESTS is set here (not in the npm script) so it works on Windows too.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./test/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.db.test.ts"],
    env: { RUN_DB_TESTS: "1" },
  },
});
