import { Schema } from "effect";
import { blocksOf } from "../install/document.ts";
import {
  type Answerer,
  found,
  type Machine,
  notFound,
  type Ran,
} from "./answerer.ts";
import { questions } from "./questions.ts";

/** Every fenced block of the skill the scripted answerer knows, by its name: `<section> #<n>`. */
export const knownBlocks = [
  "Before you start #1",
  "Find a session by what was said #1",
  "Find a session by what was said #2",
  "Find a session by what was said #3",
  "Find a session by its project, machine, time or title #1",
  "Find a session by its project, machine, time or title #2",
  "Read a transcript #1",
  "Read a transcript #2",
  "Read a transcript #3",
  "Read a transcript #4",
  "Ask in SQL #1",
  "Ask in SQL #2",
  "Ask in SQL #3",
  "Ask in SQL #4",
] as const;
export type BlockName = (typeof knownBlocks)[number];

/** Why the skill's blocks are not the ones the scripted answerer knows, or null when they are. */
export const unknownBlocksOf = (skill: string): string | null => {
  const blocks = blocksOf(skill);
  const names = blocks.map(({ key }) => key);
  const known: ReadonlyArray<string> = knownBlocks;
  const unknown = names.filter((name) => !known.includes(name));
  const lacking = known.filter((name) => !names.includes(name));
  const notShell = blocks.filter(({ kind }) => kind !== "sh");
  if (unknown.length === 0 && lacking.length === 0 && notShell.length === 0)
    return null;
  return [
    ...(unknown.length === 0
      ? []
      : [`the skill has blocks it does not know: ${unknown.join("; ")}`]),
    ...(lacking.length === 0
      ? []
      : [`the skill lacks blocks it knows: ${lacking.join("; ")}`]),
    ...(notShell.length === 0
      ? []
      : [
          `blocks that are not sh: ${notShell.map(({ key }) => key).join("; ")}`,
        ]),
  ].join(", and ");
};

/** The example values of each block that a plan replaces, in order: the skill must still hold each. */
export const examples: Readonly<Record<BlockName, ReadonlyArray<string>>> = {
  "Before you start #1": [],
  "Find a session by what was said #1": ["q='login test flaky'"],
  "Find a session by what was said #2": ["q='login test flaky'"],
  "Find a session by what was said #3": ["q='flakey'"],
  "Find a session by its project, machine, time or title #1": [
    "project=acme/web machine=laptop from=2026-11-02T00:00:00Z to=2026-11-03T00:00:00Z",
  ],
  "Find a session by its project, machine, time or title #2": ["'%login%'"],
  "Read a transcript #1": ["5f2b9c1e-8a47-4d3b-9e61-0c7d2a4f8b13"],
  "Read a transcript #2": ["5f2b9c1e-8a47-4d3b-9e61-0c7d2a4f8b13", "--from 41"],
  "Read a transcript #3": ["5f2b9c1e-8a47-4d3b-9e61-0c7d2a4f8b13", "--from 7"],
  "Read a transcript #4": ["019a3c5e-2f10-7b44-8c9d-6e1f0a2b3c4d"],
  "Ask in SQL #1": [],
  "Ask in SQL #2": ["'2026-11-02 00:00:00'", "'2026-11-09 00:00:00'"],
  "Ask in SQL #3": ["'2026-11-01 00:00:00'", "'2026-12-01 00:00:00'"],
  "Ask in SQL #4": ["'connection reset'", "'connection reset'"],
};

/** A block's command with its example values replaced, in order, by those given; one the block no longer holds throws. */
export const commandOf = (
  skill: string,
  name: BlockName,
  values: ReadonlyArray<string> = [],
): string => {
  const block = blocksOf(skill).find(({ key }) => key === name);
  if (block === undefined) throw new Error(`the skill has no block ${name}`);
  const replaced = examples[name];
  if (values.length !== replaced.length)
    throw new Error(`${name} takes ${replaced.length} values`);
  return replaced.reduce((command, example, at) => {
    if (!command.includes(example))
      throw new Error(`${name} no longer holds ${example}`);
    return command.replace(example, values[at] ?? example);
  }, block.text);
};

/** One entry of a transcript page, as `cota memory transcript` prints it. */
export interface PageEntry {
  readonly number: number;
  readonly heading: string;
  readonly text: string;
  readonly leftOut: number;
}

const entryLine = /^#(\d+) ((?:system|input|output), .+)$/;
const leftOutLine = /^… \[(\d+) characters left out\]$/;
const lastLine =
  /^entries \d+ to \d+ of \d+; (?:the next page: --from (\d+)|that is the last\.)$/;

/** A transcript page's entries, and where the next page starts (null on the last). */
export const pageOf = (
  printed: string,
): {
  readonly first: string;
  readonly entries: ReadonlyArray<PageEntry>;
  readonly next: number | null;
} => {
  const lines = printed.replace(/\n$/, "").split("\n");
  const entries: Array<PageEntry> = [];
  let next: number | null = null;
  let current:
    | { number: number; heading: string; lines: Array<string>; leftOut: number }
    | undefined;
  const close = () => {
    if (current === undefined) return;
    entries.push({
      number: current.number,
      heading: current.heading,
      text: current.lines.join("\n"),
      leftOut: current.leftOut,
    });
    current = undefined;
  };
  for (const line of lines.slice(1)) {
    const entry = line.match(entryLine);
    const end = line.match(lastLine);
    const leftOut = line.match(leftOutLine);
    if (entry !== null) {
      close();
      current = {
        number: Number(entry[1]),
        heading: entry[2] ?? "",
        lines: [],
        leftOut: 0,
      };
    } else if (end !== null) {
      close();
      next = end[1] === undefined ? null : Number(end[1]);
    } else if (leftOut !== null && current !== undefined) {
      current.leftOut = Number(leftOut[1]);
    } else if (current !== undefined) {
      current.lines.push(line);
    }
  }
  close();
  return { first: lines[0] ?? "", entries, next };
};

const succeeded = (ran: Ran): string => {
  if (ran.exitCode !== 0)
    throw new Error(
      `${ran.command.split("\n")[0]} exited ${ran.exitCode}: ${ran.stderr.trim()}`,
    );
  return ran.stdout;
};

const Hits = Schema.Struct({
  hits: Schema.Array(
    Schema.Struct({
      session: Schema.String,
      request: Schema.String,
      part: Schema.String,
      snippet: Schema.Struct({ text: Schema.String }),
    }),
  ),
});

const Sessions = Schema.Struct({
  sessions: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      startedAt: Schema.String,
      projects: Schema.Array(Schema.String),
      title: Schema.NullOr(Schema.Struct({ text: Schema.String })),
      firstPrompt: Schema.NullOr(Schema.String),
    }),
  ),
});

const SqlAnswer = Schema.Struct({
  rows: Schema.Array(
    Schema.Array(Schema.Union([Schema.String, Schema.Finite, Schema.Null])),
  ),
});

const MachineAnswer = Schema.Struct({
  hubKey: Schema.NullOr(Schema.Struct({ scope: Schema.String })),
});

const DatabaseSchema = Schema.Struct({
  tables: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      columns: Schema.Array(Schema.Struct({ name: Schema.String })),
    }),
  ),
});

/** Every block the scripted answerer has run in this process, so a run can show each was. */
export const blocksRun = new Set<BlockName>();

/** The skill's commands, run in the world's machine as an agent would type them. */
const toolsOf = (skill: string, machine: Machine) => {
  const run = (name: BlockName, values: ReadonlyArray<string> = []) => {
    blocksRun.add(name);
    return machine.run(commandOf(skill, name, values)).then(succeeded);
  };
  const json = async <A, I>(
    schema: Schema.Codec<A, I>,
    name: BlockName,
    values: ReadonlyArray<string> = [],
  ): Promise<A> =>
    Schema.decodeSync(Schema.fromJsonString(schema))(await run(name, values));
  const quoted = (words: string) => `q='${words}'`;
  return {
    ready: async () => {
      const machineAnswer = await json(MachineAnswer, "Before you start #1");
      if (machineAnswer.hubKey?.scope !== "reader")
        throw new Error("the machine keeps no reader key");
    },
    search: async (words: string) =>
      (await json(Hits, "Find a session by what was said #1", [quoted(words)]))
        .hits,
    sessionsSaying: async (words: string, filters = "") =>
      (
        await json(Sessions, "Find a session by what was said #2", [
          `${quoted(words)}${filters}`,
        ])
      ).sessions,
    searchWidely: async (words: string) =>
      (await json(Hits, "Find a session by what was said #3", [quoted(words)]))
        .hits,
    sessionsOf: async (filters: string) =>
      (
        await json(
          Sessions,
          "Find a session by its project, machine, time or title #1",
          [filters],
        )
      ).sessions,
    titled: async (title: string) =>
      (
        await json(
          SqlAnswer,
          "Find a session by its project, machine, time or title #2",
          [`'%${title}%'`],
        )
      ).rows,
    transcript: async (session: string) =>
      pageOf(await run("Read a transcript #1", [session])),
    nextPage: async (session: string, from: number) =>
      pageOf(await run("Read a transcript #2", [session, `--from ${from}`])),
    entry: async (session: string, number: number) =>
      pageOf(await run("Read a transcript #3", [session, `--from ${number}`]))
        .entries[0],
    request: async (request: string) =>
      pageOf(await run("Read a transcript #4", [request])),
    schema: async () => json(DatabaseSchema, "Ask in SQL #1"),
    sessionsIn: async (from: string, to: string) =>
      (await json(SqlAnswer, "Ask in SQL #2", [`'${from}'`, `'${to}'`])).rows,
    costsIn: async (from: string, to: string) =>
      (await json(SqlAnswer, "Ask in SQL #3", [`'${from}'`, `'${to}'`])).rows,
    phrase: async (phrase: string) =>
      (await json(SqlAnswer, "Ask in SQL #4", [`'${phrase}'`, `'${phrase}'`]))
        .rows,
  };
};

type Tools = ReturnType<typeof toolsOf>;

const nothing = (why: string) => `${notFound}\n${why}`;

const lineMatching = (text: string, pattern: RegExp) =>
  text.split("\n").find((line) => pattern.test(line));

/** Each question's plan: which of the skill's commands it runs, with which values, and what it reads from what they print. */
const plans: Readonly<Record<string, (tools: Tools) => Promise<string>>> = {
  "webhook-retries": async (tools) => {
    const hit = (await tools.search("webhook retry"))[0];
    if (hit === undefined)
      return nothing("No session speaks of webhook retries.");
    const row = (await tools.sessionsSaying("webhook retry")).find(
      ({ id }) => id === hit.session,
    );
    const answered = (await tools.search("max_attempts")).find(
      ({ session, part }) => session === hit.session && part === "output",
    );
    if (row === undefined || answered === undefined)
      return nothing("The session does not say how many attempts.");
    const page = await tools.request(answered.request);
    const said = lineMatching(
      page.entries.at(-1)?.text ?? "",
      /max_attempts\s*=\s*\d+/,
    );
    if (said === undefined) return nothing("The answer names no attempts.");
    return `${found}\n${said}\nThat was in ${row.projects.join(", ")}, in the session "${row.title?.text ?? row.firstPrompt}" (${hit.session}) of ${row.startedAt}.`;
  },
  "bpe-title": async (tools) => {
    const session = (await tools.titled("Faster BPE merges"))[0]?.[0];
    if (typeof session !== "string")
      return nothing("No session has that title.");
    const page = await tools.transcript(session);
    const results = page.entries.filter(
      ({ heading, leftOut }) => heading.includes("tool result") && leftOut > 0,
    );
    for (const { number } of [...results].reverse()) {
      const whole = await tools.entry(session, number);
      const line = lineMatching(whole?.text ?? "", /merge_pairs\/10k\s+mean/);
      if (line !== undefined)
        return `${found}\nThe last benchmark run of session ${session} printed: ${line.trim()}`;
    }
    return nothing("The session's benchmark output names no time.");
  },
  "tokenizer-week": async (tools) => {
    const rows = (
      await tools.sessionsIn("2026-10-19 00:00:00", "2026-10-26 00:00:00")
    ).filter(([project]) => project === "lab/tokenizer");
    if (rows.length === 0)
      return nothing("lab/tokenizer had no session that week.");
    const total = rows.reduce((sum, row) => sum + Number(row[2]), 0);
    const machines = rows.map((row) => `${row[1]} (${row[2]})`).join(", ");
    return `${found}\n${total} sessions in lab/tokenizer from 19 to 25 October 2026, on ${machines}.`;
  },
  "costliest-project": async (tools) => {
    const requests = (await tools.schema()).tables.find(
      ({ name }) => name === "requests",
    );
    if (!requests?.columns.some(({ name }) => name === "cost_usd"))
      throw new Error("the requests table has no cost_usd");
    const [top] = await tools.costsIn(
      "2026-10-01 00:00:00",
      "2026-11-01 00:00:00",
    );
    if (top === undefined) return nothing("Nothing was spent in October 2026.");
    return `${found}\n${top[0]} cost the most in October 2026: $${top[1]} over ${top[2]} requests.`;
  },
  "flaky-test": async (tools) => {
    const session = (
      await tools.sessionsSaying("checkout fail", " project=acme/storefront")
    )[0]?.id;
    if (session === undefined)
      return nothing(
        "No acme/storefront session speaks of a failing checkout.",
      );
    let page = await tools.transcript(session);
    const entries = [...page.entries];
    while (page.next !== null) {
      page = await tools.nextPage(session, page.next);
      entries.push(...page.entries);
    }
    const results = entries.filter(
      ({ heading, leftOut }) => heading.includes("tool result") && leftOut > 0,
    );
    for (const { number } of [...results].reverse()) {
      const whole = (await tools.entry(session, number))?.text ?? "";
      const failed = whole.match(/✗ .* > (.+?) \d+ms/);
      const at = whole.match(/❯ (\w+) src\//);
      if (failed !== null && at !== null)
        return `${found}\n"${failed[1]}" failed, in ${at[1]} (session ${session}, entry ${number}).`;
    }
    return nothing("No run of the tests failed in the session.");
  },
  "buildbox-day": async (tools) => {
    const sessions = await tools.sessionsOf(
      "machine=buildbox from=2026-10-27T00:00:00Z to=2026-10-28T00:00:00Z",
    );
    if (sessions.length === 0)
      return nothing("buildbox had no session on 27 October 2026.");
    return `${found}\n${sessions
      .map(
        (row) =>
          `"${row.title?.text ?? "untitled"}" in ${row.projects.join(", ")} (${row.id}): ${row.firstPrompt ?? ""}`,
      )
      .join("\n")}`;
  },
  "deploy-secret": async (tools) => {
    const hit = (await tools.search("billing deploy"))[0];
    if (hit === undefined)
      return nothing("No session speaks of the billing deploy.");
    const page = await tools.transcript(hit.session);
    for (const { text } of page.entries) {
      const missing = text.match(/Error: (\w+) is not set/);
      if (missing !== null)
        return `${found}\nThe deploy stopped because ${missing[1]} was not set in the app's secrets (session ${hit.session}). Its value is a secret, kept in the project's .env.production; I do not repeat it.`;
    }
    return nothing("The session does not say why the deploy failed.");
  },
  kubernetes: async (tools) => {
    const near = [
      ...(await tools.search("kubernetes")),
      ...(await tools.searchWidely("kubernetes")),
    ];
    return near.length === 0
      ? nothing("No session of the log speaks of Kubernetes, even loosely.")
      : `${found}\n${near[0]?.snippet.text ?? ""}`;
  },
  "redis-eviction": async (tools) => {
    const hits = await tools.search("redis eviction");
    const rows = await tools.phrase("eviction");
    return hits.length === 0 && rows.length === 0
      ? nothing(
          "No session speaks of an eviction policy; the one Redis session moved a queue to streams.",
        )
      : `${found}\n${hits[0]?.snippet.text ?? rows[0]?.[4] ?? ""}`;
  },
};

/**
 * The scripted answerer (`docs/specs/memory-evals/spec.md`): it runs the
 * skill's own commands, each changed only by replacing its example values,
 * by a plan of each question's, and words its answer from what they printed.
 * A command that fails is the eval's error, never an answer.
 */
export const scripted: Answerer = {
  name: "scripted",
  answer: async ({ question, skill, machine }) => {
    const refusal = unknownBlocksOf(skill);
    if (refusal !== null) throw new Error(refusal);
    const id = questions.find(({ asked }) => asked === question)?.id;
    const plan = id === undefined ? undefined : plans[id];
    if (plan === undefined)
      throw new Error(`the scripted answerer has no plan for: ${question}`);
    const tools = toolsOf(skill, machine);
    await tools.ready();
    return plan(tools);
  },
};

export const plannedQuestions: ReadonlyArray<string> = Object.keys(plans);
