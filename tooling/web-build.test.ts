import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const web = fileURLToPath(new URL("../apps/web", import.meta.url));
const main = fileURLToPath(new URL("../apps/hub/src/main.ts", import.meta.url));

const hubOver = (scratch: string, dashboard: string) => {
  const config = join(scratch, "cota.toml");
  writeFileSync(
    config,
    `
hub_keys = []

[hub]
host = "127.0.0.1"
port = 0

[clickhouse]
url = "http://127.0.0.1:9"
database = "cota"
user = "cota"
password = { env = "CLICKHOUSE_PASSWORD" }

[dashboard]
directory = "${dashboard}"

[pools.work]
protocol = "anthropic-messages"
`,
  );
  return Bun.spawn([process.execPath, main], {
    env: {
      PATH: process.env.PATH ?? "",
      COTA_CONFIG: config,
      CLICKHOUSE_PASSWORD: "clickhouse-password",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
};

const addressOf = async (stream: ReadableStream<Uint8Array>) => {
  const decoder = new TextDecoder();
  let seen = "";
  for await (const chunk of stream) {
    seen += decoder.decode(chunk, { stream: true });
    const address = seen.match(/listening on (http:\/\/[^,\s]+)/)?.[1];
    if (address !== undefined) return address;
  }
  return seen;
};

it("builds the dashboard for the browser, the API definition included, with nothing of Node or Bun in it, and a hub serves the build", async () => {
  const scratch = mkdtempSync(join(tmpdir(), "cota-web-"));
  const out = join(scratch, "dist");
  const build = Bun.spawnSync(
    [process.execPath, "run", "build", "--outDir", out, "--emptyOutDir"],
    { cwd: web },
  );

  expect(build.stderr.toString()).not.toContain("cannot load");
  expect(build.exitCode).toBe(0);
  const scripts = readdirSync(join(out, "assets"))
    .filter((file) => file.endsWith(".js"))
    .map((file) => readFileSync(join(out, "assets", file), "utf8"));
  expect(scripts).not.toHaveLength(0);
  expect(
    scripts.flatMap((script) => script.match(/\bBun\.\w+/g) ?? []),
  ).toEqual([]);

  const served = hubOver(scratch, out);
  try {
    const address = await addressOf(served.stdout);
    const index = readFileSync(join(out, "index.html"), "utf8");
    const entry = index.match(/src="(\/assets\/[^"]+\.js)"/)?.[1] ?? "";
    const answers = [];
    for (const path of ["/", "/sessions/abc", entry]) {
      const response = await fetch(`${address}${path}`);
      answers.push([
        path,
        response.status,
        response.headers.get("content-type"),
        response.headers.get("cache-control"),
        await response.text(),
      ]);
    }
    expect(answers).toEqual([
      ["/", 200, "text/html; charset=utf-8", "no-cache", index],
      ["/sessions/abc", 200, "text/html; charset=utf-8", "no-cache", index],
      [
        entry,
        200,
        "text/javascript; charset=utf-8",
        "public, max-age=31536000, immutable",
        readFileSync(join(out, entry), "utf8"),
      ],
    ]);
  } finally {
    served.kill("SIGKILL");
    await served.exited;
    rmSync(scratch, { recursive: true, force: true });
  }
}, 120_000);
