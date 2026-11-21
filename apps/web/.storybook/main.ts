import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: [
    "../../../packages/ui/src/**/*.stories.tsx",
    "../src/**/*.stories.tsx",
  ],
  addons: ["@storybook/addon-a11y", "@storybook/addon-vitest"],
  framework: "@storybook/react-vite",
  staticDirs: ["../public"],
  core: { disableTelemetry: true },
};

export default config;
