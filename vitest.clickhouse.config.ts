import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/*/src/**/*.clickhouse.test.ts"],
    globalSetup: ["apps/hub/src/modules/request-log/05-tests/reachable.ts"],
    setupFiles: ["apps/hub/src/shared/05-tests/property-seed.ts"],
    testTimeout: 30_000,
  },
});
