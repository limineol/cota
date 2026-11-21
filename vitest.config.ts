import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "apps/*/src/**/*.test.ts",
      "proofs/**/*.test.ts",
      "tooling/**/*.test.ts",
      "evals/**/*.test.ts",
      "deploy/**/*.test.ts",
    ],
    exclude: [
      ...configDefaults.exclude,
      "**/*.clickhouse.test.ts",
      "**/*.slow.test.ts",
    ],
    setupFiles: ["apps/hub/src/shared/05-tests/property-seed.ts"],
    // A law runs hundreds of cases: on a slow or busy machine one passes
    // Vitest's five seconds without anything being wrong.
    testTimeout: 30_000,
  },
});
