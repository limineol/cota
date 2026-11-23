import { Database } from "bun:sqlite";
import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const scratch = mkdtempSync(join(tmpdir(), "cota-main-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const configWith = (name: string, store: string, rest = ""): string => {
  const file = join(scratch, name);
  writeFileSync(
    file,
    `
[hub]
host = "127.0.0.1"
port = 0

[clickhouse]
url = "http://127.0.0.1:9"
database = "cota"
user = "cota"
password = { env = "CLICKHOUSE_PASSWORD" }

[store]
path = "${store}"

[[hub_keys]]
name = "clients"
scope = "subscription"
secret = { env = "CLIENTS_HUB_KEY" }

[pools.work]
protocol = "anthropic-messages"
${rest}
`,
  );
  return file;
};

const startHub = (config: string) =>
  Bun.spawn([process.execPath, join(import.meta.dirname, "main.ts")], {
    env: {
      PATH: process.env.PATH ?? "",
      COTA_CONFIG: config,
      CLICKHOUSE_PASSWORD: "clickhouse-password",
      CLIENTS_HUB_KEY: "clients-hub-key-0c1e",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

const waitForLine = async (
  stream: ReadableStream<Uint8Array>,
  wanted: RegExp,
): Promise<string> => {
  const decoder = new TextDecoder();
  let seen = "";
  for await (const chunk of stream) {
    seen += decoder.decode(chunk, { stream: true });
    if (wanted.test(seen)) return seen;
  }
  return seen;
};

describe("main", () => {
  it("opens the hub store beside the configuration and runs every module's steps before it listens, as a file only the owner can read", async () => {
    const hub = startHub(configWith("cota.toml", "cota.sqlite"));
    const store = join(scratch, "cota.sqlite");
    try {
      expect(await waitForLine(hub.stdout, /cota hub listening/)).toMatch(
        /cota hub listening on http:\/\/127\.0\.0\.1:\d+, with pools work/,
      );
      const database = new Database(store, { readonly: true });
      const tables = database
        .query(
          "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
        )
        .values();
      database.close();
      expect([tables, (statSync(store).mode & 0o777).toString(8)]).toEqual([
        [
          ["display_names"],
          ["migrations"],
          ["owner_password"],
          ["passkeys"],
          ["quota_logins"],
          ["reported_through"],
          ["route_lists"],
          ["routes"],
          ["sign_ins"],
        ],
        "600",
      ]);
    } finally {
      hub.kill("SIGKILL");
      await hub.exited;
    }
  }, 30_000);

  it("prints why it cannot use the archive directory and exits 1, before it opens the hub store", async () => {
    const hub = startHub(
      configWith(
        "archived.toml",
        "archived.sqlite",
        '[archive]\ndirectory = "gone"',
      ),
    );
    const [code, printed] = await Promise.all([
      hub.exited,
      new Response(hub.stderr).text(),
    ]);
    expect([
      code,
      printed.trim(),
      existsSync(join(scratch, "archived.sqlite")),
    ]).toEqual([
      1,
      `The archive directory ${join(scratch, "gone")} does not exist.`,
      false,
    ]);
  }, 30_000);

  it("prints why it cannot open the hub store and exits 1", async () => {
    const hub = startHub(configWith("lost.toml", "lost/cota.sqlite"));
    const [code, printed] = await Promise.all([
      hub.exited,
      new Response(hub.stderr).text(),
    ]);
    expect([code, printed.trim()]).toEqual([
      1,
      `The hub store ${join(scratch, "lost", "cota.sqlite")} cannot be created: its directory ${join(scratch, "lost")} does not exist.`,
    ]);
  }, 30_000);
});
