import { builtinModules } from "node:module";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { index, rootRoute, route } from "@tanstack/virtual-file-routes";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const hub = process.env.COTA_HUB_URL ?? "http://127.0.0.1:18080";

const runsInBun = (source: string) =>
  source.startsWith("node:") ||
  source.startsWith("bun:") ||
  source === "bun" ||
  builtinModules.includes(source);

/** Fails on an import only Node or Bun can load, which Vite would otherwise stub out (ADR-0019). */
const browserOnly: Plugin = {
  name: "cota:browser-only",
  enforce: "pre",
  resolveId(source, importer) {
    if (runsInBun(source)) {
      this.error(
        `${importer ?? "the entry"} imports "${source}", which a browser cannot load`,
      );
    }
  },
};

export default defineConfig({
  plugins: [
    browserOnly,
    tanstackRouter({
      target: "react",
      routesDirectory: "src",
      generatedRouteTree: "src/route-tree.gen.ts",
      virtualRouteConfig: rootRoute("app/root.tsx", [
        index("screens/overview/overview.route.tsx"),
        route("/sign-in", "screens/sign-in/sign-in.route.tsx"),
        route("/setup", "screens/setup/setup.route.tsx"),
        route("/sessions", "screens/sessions/sessions.route.tsx"),
        route("/sessions/$session", "screens/session/session.route.tsx"),
        route("/errors", "screens/errors/errors.route.tsx"),
        route("/sql", "screens/sql/sql.route.tsx"),
        route("/requests/$id", "screens/request/request.route.tsx"),
        route("/settings", "screens/settings/settings.route.tsx", [
          index("screens/settings/index.route.tsx"),
          route("/names", "screens/settings/names.route.tsx"),
          route("/sign-ins", "screens/settings/sign-ins.route.tsx"),
          route("/quota-logins", "screens/settings/quota-logins.route.tsx"),
          route("/routes", "screens/settings/routes.route.tsx"),
        ]),
      ]),
      addExtensions: true,
    }),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  server: {
    proxy: { "/api": hub },
  },
});
