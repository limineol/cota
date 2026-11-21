import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BunHttpClient } from "@effect/platform-bun";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { Context, Effect, Layer, Redacted } from "effect";
import { storeSteps } from "#hub.ts";
import { SetDisplayName } from "#modules/display-names/02-application/commands/set-display-name.command.ts";
import * as DisplayNames from "#modules/display-names/module.ts";
import * as ClickHouse from "#modules/request-log/04-infrastructure/persistence/clickhouse/client.ts";
import * as Constructed from "#modules/request-log/05-tests/constructed-source.ts";
import { connectionTo, server } from "#modules/request-log/05-tests/scratch.ts";
import * as RequestLog from "#modules/request-log/module.ts";
import * as HubStore from "#shared/04-infrastructure/hub-store/hub-store.ts";

const script = fileURLToPath(new URL("./import.ts", import.meta.url));
const root = mkdtempSync(join(tmpdir(), "cota-import-script-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const store = join(root, "cota.sqlite");

const ownerNames = () => {
  const database = new Database(store, { readonly: true });
  try {
    return database
      .query("SELECT kind, key, name FROM display_names ORDER BY kind, key")
      .values()
      .map((row) => row.map(String).join(" "));
  } finally {
    database.close();
  }
};

const run = async (
  args: ReadonlyArray<string>,
  env: Record<string, string>,
) => {
  const child = Bun.spawn([process.execPath, script, ...args], {
    cwd: root,
    env: { PATH: process.env.PATH ?? "", ...env },
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

const inScratchLog = <A, E>(
  effect: (database: string) => Effect.Effect<A, E, Constructed.Source>,
) =>
  Effect.gen(function* () {
    const database = `cota_test_${Bun.randomUUIDv7("hex").replaceAll("-", "")}`;
    const admin = yield* Layer.build(
      ClickHouse.layer(connectionTo("default")).pipe(
        Layer.provide(BunHttpClient.layer),
      ),
    ).pipe(
      Effect.map((context) => Context.get(context, ClickHouse.ClickHouse)),
    );
    yield* Effect.acquireRelease(
      admin.command(`CREATE DATABASE ${database}`),
      () =>
        Effect.ignore(
          admin.command(`DROP DATABASE IF EXISTS ${database} SYNC`),
        ),
    ).pipe(Effect.orDie);
    return yield* effect(database);
  }).pipe(Effect.scoped, Effect.provide(Constructed.layer));

describe("bun run import against ClickHouse", () => {
  it.live(
    "a dry run writes no name and reports what a real run adds, a real run sets only the names the owner has not given, and a second adds nothing",
    () =>
      inScratchLog((database) =>
        Effect.gen(function* () {
          const source = yield* Constructed.Source;
          // A store this hub migrated, with one name the owner gave.
          yield* Effect.gen(function* () {
            yield* (yield* SetDisplayName).execute({
              kind: "model",
              key: "gpt-5.5",
              name: "Mine",
            });
          }).pipe(
            Effect.provide(
              DisplayNames.layer({ models: RequestLog.modelNames }).pipe(
                Layer.provide(
                  HubStore.layer({ path: store, steps: storeSteps }),
                ),
              ),
            ),
          );
          const titles = join(root, "titles.db");
          const titlesDatabase = new Database(titles, { create: true });
          titlesDatabase.run(
            "CREATE TABLE titles (session_id TEXT, title TEXT)",
          );
          titlesDatabase.run(
            "INSERT INTO titles VALUES ('sA', 'Fixing the build')",
          );
          titlesDatabase.close();
          writeFileSync(
            join(root, "settings.json"),
            JSON.stringify({
              renames: {
                pool: { "claude-max": "Claude Max", unmapped: "Gone" },
                model: { "gpt-5.5": "GPT 5.5" },
                host: { "old-laptop": "Laptop" },
                project: { cota: "Cota" },
                client: { codex: "Codex" },
              },
            }),
          );
          const config = join(root, "cota.toml");
          writeFileSync(
            config,
            `hub_keys = []

[hub]
host = "127.0.0.1"
port = 8080

[clickhouse]
url = "${server.url}"
database = "${database}"
user = "${server.user}"
password = { env = "COTA_CLICKHOUSE_PASSWORD" }

[store]
path = "cota.sqlite"

[pools.claude]
protocol = "anthropic-messages"

[pools.codex]
protocol = "chatgpt-codex"

[pools.zai]
protocol = "openai-chat"
base_url = "https://api.z.ai/api/coding/paas/v4"
key = { env = "COTA_ZAI_KEY" }
`,
          );
          const importFile = join(root, "import.toml");
          writeFileSync(
            importFile,
            `[source.clickhouse]
url = "${source.connection.url}"
user = "${source.connection.user}"
password = { env = "COTA_SOURCE_PASSWORD" }
bifrost_database = "${source.bifrost}"
hub_database = "${source.hub}"

[source.files]
titles = "titles.db"
names = "settings.json"

[pools]
"claude-max" = "claude"
"codex-plus" = "codex"
zai = "zai"

[machines]
"old-laptop" = "laptop"
`,
          );
          const env = {
            COTA_CONFIG: config,
            COTA_CLICKHOUSE_PASSWORD: server.password,
            COTA_SOURCE_PASSWORD: Redacted.value(source.connection.password),
          };

          const dry = yield* Effect.promise(() =>
            run([importFile, "--dry-run"], env),
          );
          expect(dry.stderr).toBe("");
          expect(dry.code).toBe(0);
          expect(dry.stdout).toContain(
            "2026-10-28: would add 9 requests, 11 items, 4 request items and 1 title;",
          );
          expect(dry.stdout).toContain(
            "names: would set 4, already named 1; not carried: 1 (pool unmapped is not in the pool map)",
          );
          expect(dry.stdout).toContain(
            "statuses: cancelled 1, error 1, success 11",
          );
          expect(dry.stdout).toContain(
            "requests not of their pool's provider: 1 (codex, mostly openai: anthropic 1)",
          );
          expect(ownerNames()).toEqual(["model gpt-5.5 Mine"]);

          const real = yield* Effect.promise(() => run([importFile], env));
          expect(real.stderr).toBe("");
          expect(real.code).toBe(0);
          expect(real.stdout).toContain(
            "2026-10-27: added 1 request, 4 items, 1 request item and 0 titles; cost $0.01 (the source recorded $0.01)",
          );
          expect(real.stdout).toContain(
            "2026-10-29: added 3 requests, 3 items, 2 request items and 0 titles;",
          );
          expect(real.stdout).toContain(
            "not carried: 1 conversation (their items are not in the source), 1 usage (they do not add up)",
          );
          expect(real.stdout).toContain("names: set 4, already named 1");
          expect(real.stdout).toContain(
            "3 days: 3 added, 0 already held, 0 failed.",
          );
          expect(ownerNames()).toEqual([
            "client codex Codex",
            "machine laptop Laptop",
            "model gpt-5.5 Mine",
            "pool claude Claude Max",
            "project cota Cota",
          ]);

          const again = yield* Effect.promise(() => run([importFile], env));
          expect(again.code).toBe(0);
          expect(again.stdout).toContain(
            "3 days: 0 added, 3 already held, 0 failed.",
          );
          expect(again.stdout).toContain("names: set 0, already named 5");
        }),
      ),
    180_000,
  );
});
