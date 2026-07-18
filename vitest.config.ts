import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: { "server-only": "/Users/singhsuryansh12/workplace/Findex/tests/server-only.ts" },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["tests/e2e/**", "e2b/**", "node_modules/**"],
    coverage: { reporter: ["text", "json-summary"] },
  },
});
