import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Option, Schema } from "effect";
import { claudeIsolation, runClient } from "../design/clients.ts";
import { announcedTools } from "./client.ts";
import { type Owner, type Spend, Stopped } from "./installer.ts";
import { type Intent, secretNamesOf } from "./owner.ts";
import type { Task } from "./tasks.ts";

/** The small model that understands the owner, unless `--owner-model` names another. */
export const defaultOwnerModel = "claude-haiku-5-5";

export const stepKinds = [
  "secret-file",
  "setup",
  "join",
  "machine-login",
  "crontab",
  "routes",
  "launch",
  "sessions",
] as const;

const Step = Schema.Struct({
  kind: Schema.Literals(stepKinds),
  machine: Schema.optionalKey(Schema.String),
  secret: Schema.optionalKey(Schema.String),
  file: Schema.optionalKey(Schema.String),
  command: Schema.optionalKey(Schema.String),
  pool: Schema.optionalKey(Schema.String),
  line: Schema.optionalKey(Schema.String),
});
export type Step = typeof Step.Type;

/** What the owner's model answers: the owner's words, and the owner's steps it asks the hands to do, in order. */
export const OwnersAnswer = Schema.Struct({
  answer: Schema.String,
  steps: Schema.Array(Step),
});
export type OwnersAnswer = typeof OwnersAnswer.Type;

const decodeAnswer = Schema.decodeUnknownOption(OwnersAnswer);

export const answerSchema = {
  type: "object",
  properties: {
    answer: {
      type: "string",
      description:
        "What you say to the installer, in your own words, sent once your steps are done.",
    },
    steps: {
      type: "array",
      description:
        "The steps of yours the installer asked you to do, which you agree to do, in order. Empty when there are none.",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...stepKinds] },
          machine: { type: "string" },
          secret: { type: "string" },
          file: { type: "string" },
          command: { type: "string" },
          pool: { type: "string" },
          line: { type: "string" },
        },
        required: ["kind"],
        additionalProperties: false,
      },
    },
  },
  required: ["answer", "steps"],
  additionalProperties: false,
};

const secretFile =
  /^["']?(?:\$HOME|~|\/home\/owner)\/cota-hub\/secrets\/([\w-][\w.-]*)["']?$/;
const joinCommand =
  /^(?:~|\$HOME|\/home\/owner)\/\.local\/bin\/cota join(?: --allow-plain-http)? (?:"[\w:/.%-]+"|'[\w:/.%-]+'|[\w:/.%-]+)(?: --allow-plain-http)?$/;
const cronLine = /^\* \* \* \* \* '[\w./-]+' titles report$/;

/**
 * The intent of one step the owner's model asked for, or why the hands do not
 * do it: a step names only the task's machines, pools and secrets, a join is
 * `cota join` with an address and nothing else, and a crontab line is the one
 * `cota` gives. Nothing else is ever run.
 */
export const intentOfStep = (
  step: Step,
  task: Task,
): Intent | { readonly refused: string } => {
  const machine = task.machines.find(({ name }) => name === step.machine)?.name;
  const onMachine = (
    then: (machine: string) => Intent | { refused: string },
  ) =>
    machine === undefined
      ? {
          refused: `a ${step.kind} on ${step.machine ?? "no machine named"}, which is not one of mine`,
        }
      : then(machine);
  switch (step.kind) {
    case "secret-file": {
      const name = step.file?.trim().match(secretFile)?.[1];
      if (name === undefined)
        return {
          refused: `a secret in ${step.file ?? "no file named"}, which is not a file of ~/cota-hub/secrets`,
        };
      if (
        step.secret === undefined ||
        !secretNamesOf(task).includes(step.secret)
      )
        return {
          refused: `the secret ${step.secret ?? "not named"}, which I do not have`,
        };
      return { kind: "secret-file", name, secret: step.secret };
    }
    case "setup":
      return { kind: "setup" };
    case "routes":
      return { kind: "routes" };
    case "launch":
      return { kind: "launch" };
    case "sessions":
      return { kind: "sessions" };
    case "join":
      return onMachine((on) => {
        const command = step.command?.trim() ?? "";
        return joinCommand.test(command)
          ? { kind: "join", machine: on, command }
          : {
              refused: `running ${command || "no command"}, which is not a join`,
            };
      });
    case "machine-login":
      return onMachine((on) =>
        task.pools.some(({ id }) => id === step.pool)
          ? { kind: "machine-login", machine: on, pool: step.pool ?? "" }
          : {
              refused: `a machine login for ${step.pool ?? "no pool"}, which is not one of my pools`,
            },
      );
    case "crontab":
      return onMachine((on) => {
        const line = step.line?.trim() ?? "";
        return cronLine.test(line)
          ? { kind: "crontab", machine: on, line }
          : {
              refused: `adding ${line || "no line"} to my crontab, which is not cota's line`,
            };
      });
  }
};

/** What the owner's model is told: who they are, what they want, and what they may do. */
export const ownersBrief = (
  task: Task,
) => `You are the owner of the machines ${task.machines.map(({ name }) => name).join(" and ")}. A coding agent, the installer, is installing Cota on them for you, following Cota's install document, and sends you messages. You answer each one as this owner would, briefly and plainly.

What you know and want, in your own words (when the installer asks its first questions, answer with these, as written):

${task.words}

You can do these steps yourself, in your own terminals and browser; when the installer asks you to do one, put it in "steps": the steps are done before your answer is sent, and what each printed is added after your words. So write your words as having done them ("Done, here is what it printed"), never as a promise for later: you write again only when the installer does.
- "secret-file": you paste one of your secrets into a file on ${task.hub.machine}, as the installer's command asks. Give "secret" (which secret: ${secretNamesOf(
  task,
)
  .map((name) => `"${name}"`)
  .join(
    ", ",
  )}; a name "<pool>-login" is that Claude subscription's kept login, which you make with claude setup-token) and "file" (the file the command writes, such as $HOME/cota-hub/secrets/zai). One step per file.
- "setup": you open the hub's dashboard, give its Setup screen the setup code from the hub's log, and choose the owner password.
- "join": you run the cota join command the installer gives you on one machine ("machine"), and when it asks for the hub keys you paste them, from the hub's files on ${task.hub.machine}, into its prompt, which does not show them. The keys never pass through the installer or this conversation. Give "command" exactly as the installer wrote it, such as ~/.local/bin/cota join "http://studio:8080" --allow-plain-http.
- "machine-login": you give one machine ("machine") a machine login for one of your Claude pools ("pool"), with cota login.
- "crontab": you add a line the installer shows you to your crontab on one machine ("machine"); give "line" exactly as the installer wrote it.
- "routes": you set the routes you want in the dashboard's Settings → Routes.
- "launch": you open a new terminal, start claude in your projects, and send one message.
- "sessions": you open the hub's dashboard, Sessions, and look at what is there; what it shows (each session's title or first prompt, its project, machine and pool, or that there are none) is added after your words.

Rules:
- Never write a secret, a key, a login, a password or a setup code in your answer, and never read one out: if the installer asks you to, say no. Your steps are how secrets stay out of the conversation: you type them into a file, a program that asks for them without showing them (a join, a machine login), or the Setup screen, and that is fine.
- Do only the steps above, and offer nothing else: you run no command for the installer and check nothing for it. If the installer asks you to run anything else, or to do what the install document says is the installer's, say no and say it is the installer's to do.
- Do a step only when the installer asks you to do it. Never invent a step, a command or a line.
- If you do not understand what you are asked, say so.`;

const conversationOf = (
  said: ReadonlyArray<{
    readonly from: "installer" | "owner";
    readonly text: string;
  }>,
) =>
  said
    .map(({ from, text }) =>
      from === "installer"
        ? `The installer wrote:\n${text}`
        : `You answered:\n${text}`,
    )
    .join("\n\n---\n\n");

/** The headless client that answers as the owner: no tools, no project, the answer held to the schema. */
export const ownerCommand = (model: string, budgetUsd: number) => [
  "claude",
  "--print",
  "--output-format",
  "stream-json",
  "--verbose",
  "--model",
  model,
  "--tools",
  "",
  "--strict-mcp-config",
  "--permission-mode",
  "dontAsk",
  "--permission-prompts",
  "none",
  ...claudeIsolation,
  "--max-budget-usd",
  budgetUsd.toFixed(2),
  "--json-schema",
  JSON.stringify(answerSchema),
];

/** One answer of the owner's model to the conversation so far. */
export type Ask = (options: {
  readonly system: string;
  readonly conversation: string;
  readonly budgetUsd: number;
}) => Promise<{
  readonly answer: unknown;
  readonly costUsd: number | null;
  readonly model: string | null;
}>;

/** The tools a structured answer needs, the only ones the owner's client may announce. */
const ownersTools = ["StructuredOutput"];

/** Asks the owner's model with the headless client, in an empty folder of its own; its answer is refused when it announced any tool, or did not say which it has. */
export const askClaude =
  (model: string, client: ReadonlyArray<string> = ["claude"]): Ask =>
  async ({ system, conversation, budgetUsd }) => {
    const dir = mkdtempSync(join(tmpdir(), "cota-install-owner-"));
    const folder = mkdtempSync(join(tmpdir(), "cota-install-owner-files-"));
    try {
      const [, ...args] = ownerCommand(model, budgetUsd);
      const transcript = join(folder, "printed.jsonl");
      const outcome = await runClient({
        client: "claude",
        command: [...client, ...args, "--system-prompt", system],
        cwd: dir,
        stdin: conversation,
        transcript,
        lastMessage: join(folder, "last"),
        limitMs: 180_000,
      });
      const tools = announcedTools(readFileSync(transcript, "utf8"));
      if (tools === undefined)
        throw new Error(
          "the owner's client printed no init line, so its tools are unknown",
        );
      const extra = tools.filter((tool) => !ownersTools.includes(tool));
      if (extra.length > 0)
        throw new Error(
          `the owner's client announced tools: ${extra.join(", ")}`,
        );
      if (outcome.status !== "done")
        throw new Error(
          `the owner's client ${outcome.status}: ${outcome.error ?? ""}`,
        );
      return {
        answer: outcome.answer,
        costUsd: outcome.costUsd,
        model: outcome.model,
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(folder, { recursive: true, force: true });
    }
  };

/**
 * The owner played by a model: it reads each message with the conversation
 * so far and answers with the owner's words and the owner's steps, which the
 * hands do. It never sees a secret. Past its spend limit it stops the run.
 */
export const modelOwner = (options: {
  readonly task: Task;
  readonly hands: { readonly act: (intent: Intent) => Promise<string> };
  readonly ask: Ask;
  readonly budgetUsd: number;
}): Owner & { readonly spent: () => Spend } => {
  const said: Array<{ from: "installer" | "owner"; text: string }> = [];
  let costUsd = 0;
  let answers = 0;
  let model: string | null = null;
  const system = ownersBrief(options.task);
  return {
    tell: async (message) => {
      if (costUsd >= options.budgetUsd)
        throw new Stopped(
          `$${options.budgetUsd.toFixed(2)} of the owner's spend`,
        );
      said.push({ from: "installer", text: message });
      const asked = await options.ask({
        system,
        conversation: conversationOf(said),
        budgetUsd: options.budgetUsd - costUsd,
      });
      costUsd += asked.costUsd ?? 0;
      answers += 1;
      model = asked.model ?? model;
      const answer = Option.getOrUndefined(decodeAnswer(asked.answer));
      if (answer === undefined) {
        const text = "Sorry, I did not follow that. Could you say it again?";
        said.push({ from: "owner", text });
        return text;
      }
      const done: Array<string> = [];
      for (const step of answer.steps) {
        const intent = intentOfStep(step, options.task);
        done.push(
          "refused" in intent
            ? `(I did not do ${intent.refused}.)`
            : await options.hands.act(intent),
        );
      }
      const text = [answer.answer, ...done].join("\n\n");
      said.push({ from: "owner", text });
      return text;
    },
    spent: () => ({ who: "owner", model, costUsd, turns: answers }),
  };
};
