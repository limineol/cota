import type { Decorator, Preview } from "@storybook/react-vite";
import { keepTheme, ThemeProvider } from "#shared/theme.tsx";
import "#styles.css";

const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme === "dark" ? "dark" : "light";
  keepTheme(theme);
  return (
    <ThemeProvider key={theme}>
      {context.tags.includes("page") ? (
        <Story />
      ) : (
        <div className="min-h-screen bg-bg p-6 text-text">
          <Story />
        </div>
      )}
    </ThemeProvider>
  );
};

const preview: Preview = {
  globalTypes: {
    theme: {
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: ["light", "dark"],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "light" },
  decorators: [withTheme],
  parameters: {
    layout: "fullscreen",
    a11y: { test: "error" },
  },
};

export default preview;
