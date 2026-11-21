import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "@effect/vitest";

const script = fileURLToPath(new URL("./restore-archive.ts", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "cota-restore-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const usage =
  "Usage: bun run archive:restore <directory> [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>]\nRun one restore at a time.\n";

const configAt = (
  name: string,
  clickhouse: string,
  { hubKeys = "hub_keys = []", more = "" } = {},
) => {
  const file = join(root, name);
  writeFileSync(
    file,
    `${hubKeys}

[hub]
host = "127.0.0.1"
port = 8080

[clickhouse]
url = "${clickhouse}"
database = "cota_restore_contract"
user = "cota"
password = { env = "COTA_CLICKHOUSE_PASSWORD" }

[pools]
${more}`,
  );
  return file;
};

const unreachable = configAt("unreachable.toml", "http://127.0.0.1:1");

const run = async (
  args: ReadonlyArray<string>,
  env: Record<string, string> = {},
) => {
  const child = Bun.spawn([process.execPath, script, ...args], {
    cwd: root,
    env: {
      PATH: process.env.PATH ?? "",
      COTA_CONFIG: unreachable,
      COTA_CLICKHOUSE_PASSWORD: "a-password",
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

describe("bun run archive:restore", () => {
  it.each([
    [[]],
    [["a", "b"]],
    [["archive", "--from"]],
    [["archive", "--since", "2026-11-10"]],
    [["archive", "--from", "2026-11-31"]],
    [["archive", "--from", "2026-11-11", "--to", "2026-11-10"]],
  ])("prints its usage and exits 2 for the arguments %j", async (args) => {
    expect(await run(args)).toEqual({ code: 2, stdout: "", stderr: usage });
  });

  it("prints the configuration's problems and exits 2 when it is not valid", async () => {
    const ran = await run(["archive"], {
      COTA_CONFIG: join(root, "missing.toml"),
    });
    expect(ran).toEqual({
      code: 2,
      stdout: "",
      stderr: `${join(root, "missing.toml")} is not a valid configuration:\nthe file cannot be read; COTA_CONFIG names another\n`,
    });
  });

  it("reads only [clickhouse], so the hub's other secrets need not be set", async () => {
    const config = configAt("every-secret.toml", "http://127.0.0.1:1", {
      hubKeys: `hub_keys = [
  { name = "clients", scope = "subscription", secret = { env = "COTA_HUB_KEY_CLIENTS" } },
]`,
      more: `
[sign_in]
password = { env = "COTA_OWNER_PASSWORD" }
`,
    });
    const directory = join(root, "one-day");
    mkdirSync(join(directory, "2026-11-10"), { recursive: true });
    writeFileSync(join(directory, "2026-11-10", "manifest.json"), "{");
    const ran = await run([directory], { COTA_CONFIG: config });
    expect(ran.code).toBe(2);
    expect(ran.stderr).toMatch(/^ClickHouse could not be reached: .+\n$/);
  });

  it("says there is no archived day, and exits 2, for a directory that does not exist or holds none in the range", async () => {
    const missing = await run([join(root, "nowhere")]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toMatch(
      new RegExp(`^No archived day in ${join(root, "nowhere")}: .+\\n$`),
    );
    const empty = join(root, "empty");
    mkdirSync(join(empty, "2026-11-10"), { recursive: true });
    writeFileSync(join(empty, "2026-11-10", "manifest.json"), "{");
    expect(
      await run([empty, "--from", "2026-11-11", "--to", "2026-11-12"]),
    ).toEqual({
      code: 2,
      stdout: "",
      stderr: `No archived day in ${empty} from 2026-11-11 to 2026-11-12\n`,
    });
    const ran = await run([empty]);
    expect(ran.code).toBe(2);
    expect(ran.stderr).toMatch(/^ClickHouse could not be reached: .+\n$/);
  });
});
