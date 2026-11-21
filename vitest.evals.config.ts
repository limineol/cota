import { defineConfig } from "vitest/config";

// The slow tier: tests that need Docker or minutes. The design evals' make
// scratch copies of the repository, install them and pass their check, and one
// starts Storybook on port 6008; the install eval's rehearsal and the
// deployment's test each build images and run a Compose project of their own.
// They run one file at a time.
export default defineConfig({
  test: {
    include: ["evals/**/*.slow.test.ts", "deploy/**/*.slow.test.ts"],
    setupFiles: ["apps/hub/src/shared/05-tests/property-seed.ts"],
    fileParallelism: false,
    testTimeout: 600_000,
    hookTimeout: 300_000,
  },
});
