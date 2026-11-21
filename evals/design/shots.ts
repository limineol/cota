import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Option, Schema } from "effect";
import { chromium } from "playwright";
import type { Copy } from "./copy.ts";

export interface Shot {
  readonly story: string;
  readonly width: number;
  readonly theme: "light" | "dark";
  readonly path: string;
}

export interface Shots {
  readonly shots: ReadonlyArray<Shot>;
  readonly rendered: boolean;
  readonly problems: ReadonlyArray<string>;
}

export const port = 6008;
const widths = [1440, 414] as const;
const themes = ["light", "dark"] as const;
const mostStories = 4;
const tallest = 2400;

const Index = Schema.Struct({
  entries: Schema.Record(
    Schema.String,
    Schema.Struct({
      type: Schema.String,
      id: Schema.String,
      title: Schema.String,
      name: Schema.String,
      importPath: Schema.String,
    }),
  ),
});
const decodeIndex = Schema.decodeUnknownOption(Schema.fromJsonString(Index));

const answers = (url: string) =>
  fetch(url).then(
    () => true,
    () => false,
  );

const indexOf = async (url: string, until: number) => {
  while (performance.now() < until) {
    const index = await fetch(`${url}/index.json`)
      .then((response) => (response.ok ? response.text() : ""))
      .catch(() => "");
    const decoded = decodeIndex(index);
    if (Option.isSome(decoded)) return decoded.value;
    await Bun.sleep(1000);
  }
  return undefined;
};

/**
 * Screenshots of the run's stories, in both themes at 1440px and 414px, from
 * Storybook started in the copy. A story that throws, or draws nothing, is not
 * rendered, and the judge is then told it judges the diff alone.
 */
export const shotsOf = async (
  copy: Copy,
  storyFiles: ReadonlyArray<string>,
  folder: string,
  log: string,
): Promise<Shots> => {
  if (storyFiles.length === 0) {
    return {
      shots: [],
      rendered: false,
      problems: ["The run wrote no story."],
    };
  }
  mkdirSync(folder, { recursive: true });
  const url = `http://127.0.0.1:${port}`;
  if (await answers(url)) {
    return {
      shots: [],
      rendered: false,
      problems: [`Something else answers on port ${port}.`],
    };
  }
  const storybook = spawn(
    "node_modules/.bin/storybook",
    ["dev", "-p", String(port), "--exact-port", "--ci", "--no-open"],
    {
      cwd: join(copy.dir, "apps/web"),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const output = createWriteStream(log);
  storybook.stdout.pipe(output);
  storybook.stderr.pipe(output);
  const browser = await chromium.launch();
  try {
    const index = await indexOf(url, performance.now() + 180_000);
    if (index === undefined) {
      return {
        shots: [],
        rendered: false,
        problems: [`Storybook did not start on port ${port}; see ${log}.`],
      };
    }
    const stories = Object.values(index.entries)
      .filter(
        ({ type, importPath }) =>
          type === "story" &&
          storyFiles.includes(importPath.replace(/^\.\//, "")),
      )
      .slice(0, mostStories);
    const shots: Array<Shot> = [];
    const problems: Array<string> = [];
    for (const story of stories) {
      for (const theme of themes) {
        for (const width of widths) {
          const page = await browser.newPage({
            viewport: { width, height: 900 },
          });
          const errors: Array<string> = [];
          page.on("pageerror", (error) => errors.push(error.message));
          await page.goto(
            `${url}/iframe.html?id=${story.id}&viewMode=story&globals=theme:${theme}`,
          );
          await page.waitForLoadState("networkidle").catch(() => undefined);
          await page.waitForTimeout(800);
          const drawn: unknown = await page.evaluate(
            `!document.body.classList.contains("sb-show-errordisplay") && (document.querySelector("#storybook-root")?.childElementCount ?? 0) > 0`,
          );
          const name = `${story.title} / ${story.name}`;
          if (drawn !== true || errors.length > 0) {
            problems.push(
              `${name} at ${width}px, ${theme}: ${errors[0] ?? "drew nothing"}`,
            );
          } else {
            const height = Number(
              await page.evaluate("document.documentElement.scrollHeight"),
            );
            const path = join(folder, `${story.id}-${width}-${theme}.png`);
            await page.screenshot({
              path,
              fullPage: true,
              clip: { x: 0, y: 0, width, height: Math.min(height, tallest) },
            });
            shots.push({ story: name, width, theme, path });
          }
          await page.close();
        }
      }
    }
    if (stories.length === 0) {
      problems.push("Storybook lists none of the run's stories.");
    }
    return { shots, rendered: shots.length > 0, problems };
  } finally {
    await browser.close();
    if (storybook.pid !== undefined) {
      try {
        process.kill(-storybook.pid, "SIGTERM");
      } catch {}
    }
    const until = performance.now() + 30_000;
    while ((await answers(url)) && performance.now() < until) {
      await Bun.sleep(500);
    }
    output.end();
  }
};
