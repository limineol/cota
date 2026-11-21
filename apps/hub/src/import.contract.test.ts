import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "@effect/vitest";

const script = fileURLToPath(new URL("./import.ts", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "cota-import-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const usage =
  "Usage: COTA_CONFIG=<configuration> bun run import <import file> [--dry-run] [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>]\nRun one import at a time, and not beside a restore.\n";

const write = (name: string, text: string) => {
  const file = join(root, name);
  writeFileSync(file, text);
  return file;
};

// Every secret but ClickHouse's names a variable the runs leave unset.
const config = write(
  "cota.toml",
  `hub_keys = [
  { name = "clients", scope = "subscription", secret = { env = "COTA_HUB_KEY_CLIENTS" } },
]

[hub]
host = "127.0.0.1"
port = 8080

[clickhouse]
url = "http://127.0.0.1:1"
database = "cota_import_contract"
user = "cota"
password = { env = "COTA_CLICKHOUSE_PASSWORD" }

[sign_in]
password = { env = "COTA_OWNER_PASSWORD" }

[pools.claude]
protocol = "anthropic-messages"
kept_login = { env = "COTA_KEPT_LOGIN" }

[pools.zai]
protocol = "openai-chat"
base_url = "https://api.z.ai/api/coding/paas/v4"
key = { env = "COTA_ZAI_KEY" }
`,
);

const importFile = (pools: string, more = "") =>
  `[source.clickhouse]
url = "http://127.0.0.1:1"
user = "reader"
password = { env = "COTA_SOURCE_PASSWORD" }
${more}
[pools]
${pools}
`;

const run = async (
  args: ReadonlyArray<string>,
  env: Record<string, string> = {},
) => {
  const child = Bun.spawn([process.execPath, script, ...args], {
    cwd: root,
    env: {
      PATH: process.env.PATH ?? "",
      COTA_CONFIG: config,
      COTA_CLICKHOUSE_PASSWORD: "a-password",
      COTA_SOURCE_PASSWORD: "another-password",
      ...env,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
};

describe("bun run import", () => {
  it.each([
    [[]],
    [["a.toml", "b.toml"]],
    [["a.toml", "--from"]],
    [["a.toml", "--since", "2026-11-10"]],
    [["a.toml", "--to", "2026-02-30"]],
    [["a.toml", "--from", "2026-11-11", "--to", "2026-11-10"]],
  ])("prints its usage and exits 2 for the arguments %j", async (args) => {
    expect(await run(args)).toEqual({ code: 2, stdout: "", stderr: usage });
  });

  it("reads only [clickhouse], [store] and the pools, so the hub's other secrets need not be set, and stops at a source it cannot reach", async () => {
    const file = write(
      "reachable.toml",
      importFile(
        '"claude-max" = "claude"\nzai = "zai"',
        'bifrost_database = "bifrost"',
      ),
    );
    const ran = await run([file, "--dry-run"]);
    expect(ran.code).toBe(2);
    expect(ran.stdout).toBe("");
    expect(ran.stderr).toMatch(/^The source could not be read: .+\n$/);
  });

  it("refuses, and exits 2, a pool map that sends a source pool to a pool the hub does not have", async () => {
    const file = write(
      "unknown-pool.toml",
      importFile('"claude-max" = "elsewhere"'),
    );
    expect(await run([file])).toEqual({
      code: 2,
      stdout: "",
      stderr:
        "The pool map sends claude-max to elsewhere, which the hub's configuration does not have.\n",
    });
  });

  it("refuses, and exits 2, an import file it cannot read or that holds a key it does not know", async () => {
    const missing = await run([join(root, "nowhere.toml")]);
    expect(missing).toEqual({
      code: 2,
      stdout: "",
      stderr: `The import file ${join(root, "nowhere.toml")} cannot be read.\n`,
    });
    const file = write(
      "unknown-key.toml",
      importFile('"claude-max" = "claude"', 'database = "bifrost"'),
    );
    const ran = await run([file]);
    expect(ran.code).toBe(2);
    expect(ran.stderr).toContain(`${file} is not a valid configuration`);
  });
});
