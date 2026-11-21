import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const index =
  '<!doctype html>\n<html lang="en"><head><title>Cota</title><script src="/theme.js"></script><script type="module" src="/assets/index-0xC89QOu.js"></script></head><body><div id="root"></div></body></html>\n';

/** What a file outside the dashboard's folder holds, which no answer may carry. */
export const outside = "outside-the-dashboard-7c1f";

/** The built files, by path, as the hub is asked for them. */
export const files: Readonly<Record<string, string>> = {
  "/index.html": index,
  "/theme.js": "document.documentElement.dataset.theme = 'dark';\n",
  "/assets/index-0xC89QOu.js": "console.log('the dashboard');\n",
  "/assets/index-C7ncvV74.css": "body { margin: 0; }\n",
  "/assets/geist-latin-wght-normal-BgDaEnEv.woff2": "wOF2",
};

export interface Scratch {
  /** The folder the hub serves: `files` under it. */
  readonly dashboard: string;
  /** Beside `dashboard`: a file `secret.txt`, and a folder whose name begins with the dashboard's, holding another. */
  readonly parent: string;
  /** A folder that holds the build's files but `index.html`. */
  readonly unbuilt: string;
  readonly remove: () => void;
}

/**
 * A built dashboard in a temporary folder, with files outside it that hold
 * `outside`.
 */
export const make = (): Scratch => {
  const parent = mkdtempSync(join(tmpdir(), "cota-dashboard-"));
  const dashboard = join(parent, "dist");
  const unbuilt = join(parent, "unbuilt");
  for (const [path, content] of Object.entries(files)) {
    for (const root of [dashboard, unbuilt]) {
      if (root === unbuilt && path === "/index.html") continue;
      mkdirSync(join(root, "assets"), { recursive: true });
      writeFileSync(join(root, path), content);
    }
  }
  writeFileSync(join(parent, "secret.txt"), outside);
  mkdirSync(join(parent, "dist-twin"));
  writeFileSync(join(parent, "dist-twin", "secret.txt"), outside);
  return {
    dashboard,
    parent,
    unbuilt,
    remove: () => rmSync(parent, { recursive: true, force: true }),
  };
};
