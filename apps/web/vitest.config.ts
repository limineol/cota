import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import {
  defineConfig,
  mergeConfig,
  type TestProjectInlineConfiguration,
} from "vitest/config";
import viteConfig from "./vite.config.ts";

const stories = (theme: "light" | "dark"): TestProjectInlineConfiguration => ({
  extends: true,
  plugins: [
    storybookTest({
      configDir: ".storybook",
      storybookScript: "bun run storybook --no-open",
      initialGlobals: { theme },
    }),
  ],
  test: {
    name: `stories-${theme}`,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "chromium" }],
    },
  },
});

export default mergeConfig(
  viteConfig,
  defineConfig({ test: { projects: [stories("light"), stories("dark")] } }),
);
