import { Schema } from "effect";
import type {
  DoctorReport,
  Home,
  LoggedRequest,
  Observed,
  ReportedTitle,
  StandInStart,
  Unread,
} from "./criteria.ts";
import { sharedFiles } from "./criteria.ts";
import type { Ending, Entry } from "./runs.ts";
import type { RoutedClient, RouteList, Task } from "./tasks.ts";
import { checkout, type World } from "./world.ts";

const DoctorReportSchema = Schema.Struct({
  ok: Schema.Boolean,
  checks: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      outcome: Schema.Literals(["passed", "failed", "warned", "skipped"]),
      problem: Schema.NullOr(Schema.String),
      fix: Schema.NullOr(Schema.String),
    }),
  ),
});

/** What `cota doctor --json` printed, decoded. */
export const doctorOf: (text: string) => DoctorReport = Schema.decodeSync(
  Schema.fromJsonString(DoctorReportSchema),
);

const lines = <A>(schema: Schema.Codec<A>, text: string): ReadonlyArray<A> => {
  const decode = Schema.decodeSync(Schema.fromJsonString(schema));
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => decode(line));
};

const RequestRow = Schema.Struct({
  session: Schema.String,
  machine: Schema.String,
  project: Schema.String,
  client: Schema.String,
  pool: Schema.String,
  outcome: Schema.String,
});

const TitleRow = Schema.Struct({
  session: Schema.String,
  title: Schema.String,
});

const StartLine = Schema.Struct({
  args: Schema.Array(Schema.String),
  cwd: Schema.String,
  session: Schema.NullOr(Schema.String),
});

const RouteListsSchema = Schema.Struct({
  clients: Schema.Array(
    Schema.Struct({
      client: Schema.String,
      routes: Schema.Array(
        Schema.Struct({ pattern: Schema.String, pool: Schema.String }),
      ),
      defaultPool: Schema.NullOr(Schema.Struct({ pool: Schema.String })),
    }),
  ),
});

const HomeSchema = Schema.Struct({
  path: Schema.String,
  files: Schema.Record(Schema.String, Schema.String),
  texts: Schema.Record(Schema.String, Schema.String),
});

const SecretFiles = Schema.Record(Schema.String, Schema.String);

const unread = (error: unknown): Unread => ({
  unread:
    error instanceof Error
      ? (error.message.split("\n")[0] ?? "")
      : String(error),
});

const attempt = async <A>(read: () => Promise<A>): Promise<A | Unread> => {
  try {
    return await read();
  } catch (error) {
    return unread(error);
  }
};

/** Runs a script with the machine's Bun, the script read from standard input so that no quoting can break it. */
const bunScript = async (world: World, machine: string, script: string) => {
  const ran = await world.shell(machine, 'bun -e "$(cat)"', {
    stdin: script,
    limitMs: 120_000,
  });
  if (ran.exitCode !== 0)
    throw new Error(
      `a script of the eval's exited ${ran.exitCode ?? "at its time limit"}: ${ran.stderr.trim().split("\n").at(-1) ?? ""}`,
    );
  return ran.stdout;
};

const shellOut = async (
  world: World,
  machine: string,
  command: string,
  cwd?: string,
) => {
  const ran = await world.shell(machine, command, {
    ...(cwd === undefined ? {} : { cwd }),
    limitMs: 120_000,
  });
  if (ran.exitCode !== 0) {
    throw new Error(
      `\`${command.split("\n")[0]}\` exited ${ran.exitCode ?? "at its time limit"}: ${ran.stderr.trim().split("\n").at(-1) ?? ""}`,
    );
  }
  return ran.stdout;
};

/** A home's files (but the checkout's and Bun's cache) with their modes and digests, and the text of the files `cota` writes a part of. */
export const homeOf = async (world: World, machine: string): Promise<Home> => {
  const script = `
const { readdirSync, lstatSync, readFileSync } = require("node:fs");
const home = process.env.HOME;
const files = {};
const texts = {};
const walk = (dir, rel) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = rel === "" ? entry.name : rel + "/" + entry.name;
    if (path === "cota" || path === ".bun") continue;
    const full = dir + "/" + entry.name;
    if (entry.isDirectory()) walk(full, path);
    else files[path] = lstatSync(full).mode.toString(8) + ":" + (entry.isSymbolicLink() ? "link" : new Bun.CryptoHasher("sha256").update(readFileSync(full)).digest("hex"));
  }
};
walk(home, "");
for (const path of ${JSON.stringify(Object.keys(sharedFiles))}) {
  try { texts[path] = readFileSync(home + "/" + path, "utf8"); } catch {}
}
console.log(JSON.stringify({ path: home, files, texts }));`;
  return Schema.decodeSync(Schema.fromJsonString(HomeSchema))(
    await bunScript(world, machine, script),
  );
};

const startsOf = async (
  world: World,
  machine: string,
): Promise<ReadonlyArray<StandInStart>> => {
  const out = await shellOut(
    world,
    machine,
    'for file in ~/.stand-ins/*.jsonl; do [ -e "$file" ] || continue; client=$(basename "$file" .jsonl); while IFS= read -r line; do printf "%s\\t%s\\n" "$client" "$line"; done < "$file"; done',
  );
  return out
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const tab = line.indexOf("\t");
      const [start] = lines(StartLine, line.slice(tab + 1));
      if (start === undefined)
        throw new Error("a stand-in's line does not read");
      return { client: line.slice(0, tab), ...start };
    });
};

const routesOf = async (
  world: World,
  task: Task,
  ownerPassword: string,
): Promise<Readonly<Record<RoutedClient, RouteList>>> => {
  const curl = (path: string, method: string, body?: unknown) =>
    [
      `url = ${JSON.stringify(`${task.hub.address}${path}`)}`,
      `request = ${JSON.stringify(method)}`,
      'cookie = "/tmp/eval-reader/cookies"',
      'cookie-jar = "/tmp/eval-reader/cookies"',
      "fail-with-body",
      ...(body === undefined
        ? []
        : [
            'header = "content-type: application/json"',
            `data = ${JSON.stringify(JSON.stringify(body))}`,
          ]),
      "",
    ].join("\n");
  const call = async (path: string, method: string, body?: unknown) => {
    const ran = await world.shell(
      task.hub.machine,
      "mkdir -p /tmp/eval-reader && curl -s --config -",
      {
        stdin: curl(path, method, body),
        limitMs: 30_000,
      },
    );
    if (ran.exitCode !== 0)
      throw new Error(`${method} ${path} failed: ${ran.stdout.slice(0, 200)}`);
    return ran.stdout;
  };
  await call("/api/sign-in", "POST", { password: ownerPassword });
  const lists = Schema.decodeSync(Schema.fromJsonString(RouteListsSchema))(
    await call("/api/routes", "GET"),
  );
  await call("/api/sign-out", "POST");
  const listOf = (client: RoutedClient): RouteList => {
    const list = lists.clients.find((each) => each.client === client);
    if (list === undefined)
      throw new Error(`GET /api/routes has no list of ${client}`);
    return {
      routes: list.routes.map(({ pattern, pool }) => ({ pattern, pool })),
      defaultPool: list.defaultPool?.pool ?? null,
    };
  };
  return { "claude-code": listOf("claude-code"), codex: listOf("codex") };
};

/** Every secret file of the world's machines (the hub's step 3, `cota`'s hub keys and machine logins) and every setup code the hub logged, by name. */
const fileSecretsOf = async (world: World, task: Task) => {
  const script = `const { readdirSync, readFileSync } = require("node:fs"); const out = {}; for (const dir of ["cota-hub/secrets", ".config/cota/hub-keys", ".config/cota/logins"]) { try { for (const name of readdirSync(process.env.HOME + "/" + dir)) out[dir + "/" + name] = readFileSync(process.env.HOME + "/" + dir + "/" + name, "utf8").trim(); } catch {} } console.log(JSON.stringify(out));`;
  const found: Array<{ name: string; value: string }> = [];
  for (const { name } of task.machines) {
    const files = Schema.decodeSync(Schema.fromJsonString(SecretFiles))(
      await bunScript(world, name, script),
    );
    found.push(
      ...Object.entries(files).map(([file, value]) => ({
        name: `secret in ${name}:~/${file}`,
        value,
      })),
    );
  }
  const log = await world.hubLog();
  for (const match of log.matchAll(
    /give it the setup code (\S+) and choose/g,
  )) {
    if (match[1] !== undefined)
      found.push({ name: "setup code", value: match[1] });
  }
  return found;
};

/** The sessions the task's launches started, once their stand-ins have sent them. */
const launchedSessions = (starts: Observed["starts"]): ReadonlyArray<string> =>
  Object.values(starts).flatMap((each) =>
    "unread" in each
      ? []
      : each.flatMap(({ session }) => (session === null ? [] : [session])),
  );

const titlesOf = async (world: World): Promise<ReadonlyArray<ReportedTitle>> =>
  lines(
    TitleRow,
    await world.clickhouse(
      "SELECT session, argMax(title, reported_at) AS title FROM session_titles GROUP BY session",
    ),
  );

const requestsOf = async (
  world: World,
): Promise<ReadonlyArray<LoggedRequest>> =>
  lines(
    RequestRow,
    await world.clickhouse(
      "SELECT session, machine, project, client, pool, toString(outcome) AS outcome FROM requests ORDER BY started_at",
    ),
  );

/**
 * Reads what the criteria need from the world once the installer has ended:
 * the title reporter's schedule given up to `titleWaitMs` to send each launch's
 * title, then the hub's requests, titles and routes, doctor on every machine,
 * every home, and every secret to look for.
 */
export const observe = async (options: {
  readonly world: World;
  readonly task: Task;
  readonly ending: Ending;
  readonly error: string | null;
  readonly transcript: ReadonlyArray<Entry>;
  readonly before: Readonly<Record<string, Home | Unread>>;
  readonly ownersSecrets: ReadonlyArray<{
    readonly name: string;
    readonly value: string;
  }>;
  readonly ownerPassword: string;
  readonly titleWaitMs: number;
}): Promise<Observed> => {
  const { world, task } = options;
  const starts = Object.fromEntries(
    await Promise.all(
      task.machines.map(
        async ({ name }) =>
          [name, await attempt(() => startsOf(world, name))] as const,
      ),
    ),
  );
  const sessions = launchedSessions(starts);
  const waitUntil = Date.now() + options.titleWaitMs;
  const missing = (read: ReadonlyArray<ReportedTitle> | Unread) =>
    !("unread" in read) &&
    sessions.some((session) => !read.some((each) => each.session === session));
  let titles = await attempt(() => titlesOf(world));
  while (missing(titles) && Date.now() < waitUntil) {
    await Bun.sleep(5_000);
    titles = await attempt(() => titlesOf(world));
  }
  const doctor = Object.fromEntries(
    await Promise.all(
      task.machines.map(
        async ({ name }) =>
          [
            name,
            await attempt(async () => {
              const ran = await world.shell(
                name,
                "~/.local/bin/cota doctor --json",
                { cwd: checkout, limitMs: 120_000 },
              );
              return doctorOf(ran.stdout);
            }),
          ] as const,
      ),
    ),
  );
  const homes = Object.fromEntries(
    await Promise.all(
      task.machines.map(async ({ name }) => {
        const before = options.before[name];
        if (before === undefined)
          return [
            name,
            { unread: "its home was not read before the installer started" },
          ] as const;
        if ("unread" in before) return [name, before] as const;
        const after = await attempt(() => homeOf(world, name));
        return [name, "unread" in after ? after : { before, after }] as const;
      }),
    ),
  );
  const fileSecrets = await attempt(() => fileSecretsOf(world, task));
  return {
    ending: options.ending,
    error: options.error,
    doctor,
    requests: await attempt(() => requestsOf(world)),
    titles,
    routes: await attempt(() => routesOf(world, task, options.ownerPassword)),
    starts,
    homes,
    secrets:
      "unread" in fileSecrets
        ? fileSecrets
        : [...options.ownersSecrets, ...fileSecrets],
    transcript: options.transcript,
  };
};
