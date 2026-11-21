import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Option, Schema } from "effect";
import { type Client, judgeCommand, runClient } from "./clients.ts";
import type { Rule } from "./rubric.ts";
import {
  type Judgement,
  type Verdict,
  VerdictWord,
  verdictWords,
} from "./runs.ts";
import type { Shot } from "./shots.ts";

/** What the judge is given of a run, and nothing more: never its arm, its id or its place in the order the runs were made. */
export interface Judged {
  readonly task: string;
  readonly patch: string;
  readonly shots: ReadonlyArray<Shot>;
}

export const judgedOf = (run: Judged): Judged => ({
  task: run.task,
  patch: run.patch,
  shots: run.shots,
});

const mulberry32 = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** The items in an order drawn from the seed, each exactly once. */
export const shuffled = <A>(
  items: ReadonlyArray<A>,
  seed: number,
): Array<A> => {
  const random = mulberry32(seed);
  const order = [...items];
  for (let index = order.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    const here = order[index];
    const there = order[other];
    if (here === undefined || there === undefined) continue;
    order[index] = there;
    order[other] = here;
  }
  return order;
};

/** The added lines of a patch that quote the document or a rule by its id: shown to the judge as they are, and reported. */
export const leaksOf = (
  patch: string,
  ruleIds: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const leaks: Array<string> = [];
  let file = "";
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.replace(/^\+\+\+ (b\/)?/, "");
    } else if (
      line.startsWith("+") &&
      ["DESIGN.md", ...ruleIds].some((trace) => line.includes(trace))
    ) {
      leaks.push(`${file}: ${line.slice(1).trim().slice(0, 160)}`);
    }
  }
  return leaks;
};

const mostPatch = 400_000;

/** The judge's instructions and the run's evidence, as text; the screenshots go beside it, in the order `shots` lists them. */
export const judgePrompt = (
  rules: ReadonlyArray<Rule>,
  judged: Judged,
): string => {
  const patch =
    judged.patch.length > mostPatch
      ? `${judged.patch.slice(0, mostPatch)}\n[The patch goes on for ${judged.patch.length - mostPatch} more characters.]`
      : judged.patch;
  return [
    "You are judging a change a coding agent made to a React dashboard, against the rules of its design. Below are the task the agent was given, the rules, the change as a patch, and screenshots of the stories it wrote, in a light and a dark theme at 1440px and 414px wide.",
    "",
    "For every rule, answer one of:",
    "- followed: the change has something the rule covers, and it does as the rule says;",
    "- broken: the change does something the rule says not to do, or what its Bad example shows;",
    "- not-applicable: the change has nothing the rule's scope covers.",
    "Give your evidence for each: a file and a line of the patch, or what a screenshot shows (name the story, the width and the theme). Judge what the change does, not what its comments say about it. Judge only the files the patch adds or changes. Answer every rule, once, by its id.",
    "",
    judged.shots.length === 0
      ? "None of the change's stories could be drawn, so there are no screenshots: judge the patch alone."
      : `Screenshots, in the order they follow: ${judged.shots.map((shot, index) => `(${index + 1}) ${shot.story}, ${shot.width}px, ${shot.theme}`).join("; ")}.`,
    "",
    "## The task",
    "",
    judged.task.trim(),
    "",
    "## The rules",
    "",
    ...rules.flatMap((rule) => [
      `### ${rule.id}`,
      "",
      `Scope: ${rule.scope}`,
      "",
      rule.text,
      "",
      `Bad: ${rule.bad}`,
      "",
      `Good: ${rule.good}`,
      "",
    ]),
    "## The change",
    "",
    "```diff",
    patch,
    "```",
  ].join("\n");
};

export const answerSchema = {
  type: "object",
  additionalProperties: false,
  required: ["verdicts"],
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rule", "verdict", "evidence"],
        properties: {
          rule: { type: "string" },
          verdict: { type: "string", enum: verdictWords },
          evidence: { type: "string" },
        },
      },
    },
  },
};

const Answer = Schema.Struct({
  verdicts: Schema.Array(
    Schema.Struct({
      rule: Schema.String,
      verdict: VerdictWord,
      evidence: Schema.String,
    }),
  ),
});
const decodeAnswer = Schema.decodeUnknownOption(Answer);

/** The judge's verdict on each rule, in the rubric's order: a rule it did not answer is unjudged, and an answer to no rule is dropped. */
export const verdictsOf = (
  rules: ReadonlyArray<Rule>,
  answer: unknown,
): ReadonlyArray<Verdict> | undefined => {
  const decoded = decodeAnswer(answer);
  if (Option.isNone(decoded)) return undefined;
  return rules.map(
    (rule) =>
      decoded.value.verdicts.find((verdict) => verdict.rule === rule.id) ?? {
        rule: rule.id,
        verdict: "unjudged",
        evidence: "The judge did not answer this rule.",
      },
  );
};

const messageOf = (prompt: string, shots: ReadonlyArray<Shot>) =>
  `${JSON.stringify({
    type: "user",
    message: {
      role: "user",
      content: [
        { type: "text", text: prompt },
        ...shots.map((shot) => ({
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: readFileSync(shot.path).toString("base64"),
          },
        })),
      ],
    },
  })}\n`;

/** One judging of one run by a client with no tools, from a folder holding nothing. */
export const judgeWith = async (options: {
  readonly client: Client;
  readonly model: string | null;
  readonly rules: ReadonlyArray<Rule>;
  readonly judged: Judged;
  readonly transcript: string;
}): Promise<Judgement> => {
  const folder = mkdtempSync(join(tmpdir(), "cota-design-judge-"));
  try {
    const schemaFile = join(folder, "answer.schema.json");
    writeFileSync(schemaFile, JSON.stringify(answerSchema));
    const lastMessage = join(folder, "answer.json");
    const empty = join(folder, "empty");
    mkdirSync(empty);
    const prompt = judgePrompt(options.rules, options.judged);
    const outcome = await runClient({
      client: options.client,
      command: judgeCommand(
        options.client,
        options.model,
        empty,
        schemaFile,
        lastMessage,
        options.judged.shots.map(({ path }) => path),
      ),
      cwd: empty,
      stdin:
        options.client === "claude"
          ? messageOf(prompt, options.judged.shots)
          : prompt,
      transcript: options.transcript,
      lastMessage,
      limitMs: 10 * 60_000,
    });
    const onDiffAlone = options.judged.shots.length === 0;
    const spent = { seconds: outcome.seconds, costUsd: outcome.costUsd };
    if (outcome.status !== "done") {
      return {
        status: "failed",
        error: outcome.error,
        onDiffAlone,
        verdicts: [],
        ...spent,
      };
    }
    const verdicts = verdictsOf(options.rules, outcome.answer);
    return verdicts === undefined
      ? {
          status: "failed",
          error: "The judge's answer did not hold a verdict for each rule.",
          onDiffAlone,
          verdicts: [],
          ...spent,
        }
      : { status: "judged", error: null, onDiffAlone, verdicts, ...spent };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
};
