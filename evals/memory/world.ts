import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Machine, Ran } from "./answerer.ts";
import { log, plantedSecret, titles } from "./log.ts";

/** The checkout under test, whose hub, `cota` and skill the world runs. */
export const checkout = fileURLToPath(new URL("../..", import.meta.url));

/** The ClickHouse a world is made in: `compose.dev.yaml`'s, unless the ClickHouse tier's variables name another. */
export const clickhouse = {
  url: process.env.COTA_TEST_CLICKHOUSE_URL ?? "http://127.0.0.1:18123",
  user: process.env.COTA_TEST_CLICKHOUSE_USER ?? "cota",
  password:
    process.env.COTA_TEST_CLICKHOUSE_PASSWORD ?? "throwaway-dev-password",
};

/** Every database, SQL user and settings profile a world makes starts with this. */
export const databasePrefix = "cota_memory_";

/** A world's request log, read through its hub, and the machine an answerer works in. */
export interface World {
  readonly database: string;
  /** The run's own directory: the hub's configuration and store, and the machine's home. */
  readonly directory: string;
  readonly hub: string;
  readonly machine: Machine;
  /** The secrets of the world, by name: no answer, and nothing an answerer runs or reads, may hold the reader key; no answer the planted one. */
  readonly secrets: { readonly readerKey: string; readonly planted: string };
  /** Removes the world whole: the hub, the database, its SQL user and settings profile, and its directory. */
  readonly remove: () => Promise<void>;
}

/** Answers SQL as the ClickHouse's own user, `JSONEachRow` when it selects. */
export const clickhouseQuery = async (sql: string): Promise<string> => {
  const response = await fetch(clickhouse.url, {
    method: "POST",
    headers: {
      "x-clickhouse-user": clickhouse.user,
      "x-clickhouse-key": clickhouse.password,
    },
    body: sql,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`ClickHouse answered ${response.status}`);
  return text;
};

const commandLimitMs = 60_000;

const spawned = async (
  argv: ReadonlyArray<string>,
  options: {
    readonly stdin?: string;
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
  },
): Promise<Omit<Ran, "command" | "stdin">> => {
  const child = Bun.spawn([...argv], {
    cwd: options.cwd,
    env: options.env,
    stdin: options.stdin === undefined ? "ignore" : Buffer.from(options.stdin),
    stdout: "pipe",
    stderr: "pipe",
  });
  let stopped = false;
  const timer = setTimeout(() => {
    stopped = true;
    child.kill("SIGKILL");
  }, commandLimitMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(timer);
  return { exitCode: stopped ? null : exitCode, stdout, stderr };
};

const freePort = (): number => {
  const server = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = server.port;
  server.stop(true);
  if (port === undefined) throw new Error("no free port was found");
  return port;
};

const waitUntilUp = async (hub: string, exited: () => boolean) => {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (exited()) throw new Error("the world's hub exited before it was up");
    const up = await fetch(`${hub}/health`)
      .then((response) => response.ok)
      .catch(() => false);
    if (up) return;
    await Bun.sleep(250);
  }
  throw new Error("the world's hub was not up within 60 seconds");
};

/**
 * Makes a memory world (`docs/specs/memory-evals/spec.md`, The world): a
 * scratch database holding the constructed request log, a hub reading it,
 * the titles reported to it, and a machine that keeps the hub's reader key.
 * A failure on the way removes what was made.
 */
export const makeWorld = async (): Promise<World> => {
  const run = `${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
  const database = `${databasePrefix}${run}`;
  const readerKey = `cota-memory-reader-${crypto.randomUUID()}`;
  const root = mkdtempSync(join(tmpdir(), "cota-memory-"));
  const home = join(root, "home");
  const bin = join(root, "bin");
  const work = join(root, "work");
  for (const directory of [home, bin, work]) mkdirSync(directory);
  let hubProcess: ReturnType<typeof Bun.spawn> | undefined;
  let exited = false;

  const remove = async () => {
    if (hubProcess !== undefined && !exited) {
      hubProcess.kill("SIGTERM");
      const ended = await Promise.race([
        hubProcess.exited.then(() => true),
        Bun.sleep(10_000).then(() => false),
      ]);
      if (!ended) hubProcess.kill("SIGKILL");
    }
    for (const sql of [
      `DROP DATABASE IF EXISTS ${database} SYNC`,
      `DROP USER IF EXISTS ${database}_sql`,
      `DROP SETTINGS PROFILE IF EXISTS ${database}_sql`,
    ]) {
      await clickhouseQuery(sql);
    }
    rmSync(root, { recursive: true, force: true });
  };

  try {
    await clickhouseQuery(`CREATE DATABASE ${database}`);
    const written = await spawned(
      [
        process.execPath,
        join(
          checkout,
          "apps/hub/src/modules/request-log/05-tests/write-request-log.ts",
        ),
        database,
      ],
      {
        stdin: JSON.stringify(log),
        cwd: checkout,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          COTA_TEST_CLICKHOUSE_URL: clickhouse.url,
          COTA_TEST_CLICKHOUSE_USER: clickhouse.user,
          COTA_TEST_CLICKHOUSE_PASSWORD: clickhouse.password,
        },
      },
    );
    if (written.exitCode !== 0)
      throw new Error(
        `the request log was not written: ${written.stderr.slice(-2000)}`,
      );

    const port = freePort();
    const hub = `http://127.0.0.1:${port}`;
    const config = join(root, "cota.toml");
    writeFileSync(
      config,
      `[hub]
host = "127.0.0.1"
port = ${port}

[clickhouse]
url = "${clickhouse.url}"
database = "${database}"
user = "${clickhouse.user}"
password = { env = "COTA_CLICKHOUSE_PASSWORD" }

[store]
path = "${join(root, "cota.sqlite")}"

[[hub_keys]]
name = "agents"
scope = "reader"
secret = { env = "COTA_HUB_KEY_AGENTS" }

[pools]
`,
    );
    const hubLog = Bun.file(join(root, "hub.log"));
    hubProcess = Bun.spawn(
      [process.execPath, join(checkout, "apps/hub/src/main.ts")],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          COTA_CONFIG: config,
          COTA_CLICKHOUSE_PASSWORD: clickhouse.password,
          COTA_HUB_KEY_AGENTS: readerKey,
        },
        stdin: "ignore",
        stdout: hubLog,
        stderr: hubLog,
      },
    );
    void hubProcess.exited.then(() => {
      exited = true;
    });
    await waitUntilUp(hub, () => exited);

    const byMachine = Map.groupBy(titles, ({ machine }) => machine);
    for (const [machine, reported] of byMachine) {
      const response = await fetch(`${hub}/api/session-titles`, {
        method: "PUT",
        headers: {
          "x-cota-key": readerKey,
          "x-cota-machine": machine,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          titles: Object.fromEntries(
            reported.map(({ session, title }) => [session, title]),
          ),
        }),
      });
      if (response.status !== 204)
        throw new Error(`the hub answered ${response.status} to the titles`);
    }

    const configuration = join(home, ".config", "cota");
    mkdirSync(configuration, { recursive: true, mode: 0o700 });
    writeFileSync(
      join(configuration, "config.toml"),
      `hub = "${hub}"\nmachine = "studio"\nshims = false\n`,
      { mode: 0o600 },
    );
    const cota = join(bin, "cota");
    writeFileSync(
      cota,
      `#!/bin/sh\nexec '${process.execPath}' '${join(checkout, "apps/cli/src/main.ts")}' "$@"\n`,
      { mode: 0o755 },
    );
    const env = { HOME: home, PATH: `${bin}:/usr/bin:/bin` };
    const machine: Machine = {
      run: async (command, stdin) => ({
        command,
        stdin: stdin ?? null,
        ...(await spawned(["/bin/sh", "-c", command], {
          cwd: work,
          env,
          ...(stdin === undefined ? {} : { stdin }),
        })),
      }),
      cota: async (args, stdin) => ({
        command: ["cota", ...args].join(" "),
        stdin: stdin ?? null,
        ...(await spawned([cota, ...args], {
          cwd: work,
          env,
          ...(stdin === undefined ? {} : { stdin }),
        })),
      }),
    };
    const kept = await machine.cota(["memory", "key"], `${readerKey}\n`);
    if (kept.exitCode !== 0)
      throw new Error(`cota memory key failed: ${kept.stderr}`);

    return {
      database,
      directory: root,
      hub,
      machine,
      secrets: { readerKey, planted: plantedSecret },
      remove,
    };
  } catch (error) {
    await remove();
    throw error;
  }
};

/** The databases, SQL users and settings profiles of worlds left in the ClickHouse, by name. */
export const leftInClickHouse = async (): Promise<ReadonlyArray<string>> => {
  const names = await clickhouseQuery(
    `SELECT name FROM system.databases WHERE startsWith(name, '${databasePrefix}')
     UNION ALL SELECT name FROM system.users WHERE startsWith(name, '${databasePrefix}')
     UNION ALL SELECT name FROM system.settings_profiles WHERE startsWith(name, '${databasePrefix}')
     FORMAT TSV`,
  );
  return names.split("\n").filter((name) => name !== "");
};
