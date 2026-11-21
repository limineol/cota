import { Option, Schema } from "effect";
import { allowedTools } from "./tools.ts";

/**
 * Why a client's announced tools are refused, or null: an agent starts only
 * when its client announces the eval's tools (the install eval's two unless
 * others are given) and nothing else.
 */
export const refusalOf = (
  announced: ReadonlyArray<string>,
  allowed: ReadonlyArray<string> = allowedTools,
): string | null => {
  const extra = [...new Set(announced)].filter(
    (tool) => !allowed.includes(tool),
  );
  const missing = allowed.filter((tool) => !announced.includes(tool));
  if (extra.length === 0 && missing.length === 0) return null;
  return [
    ...(extra.length === 0 ? [] : [`it announced ${extra.join(", ")}`]),
    ...(missing.length === 0 ? [] : [`it lacked ${missing.join(", ")}`]),
  ].join(", and ");
};

/** The parts of the client's context that hold no tool; any other part is announced as one, so an unknown part refuses the run. */
const toollessParts = [
  "System prompt",
  "MCP tools",
  "Messages",
  "Autocompact buffer",
  "Free space",
];

const ContextUsage = Schema.Struct({
  categories: Schema.Array(Schema.Struct({ name: Schema.String })),
  mcpTools: Schema.Array(Schema.Struct({ name: Schema.String })),
  agents: Schema.Array(Schema.Unknown),
});

const ControlResponse = Schema.Struct({
  type: Schema.Literal("control_response"),
  response: Schema.Struct({
    subtype: Schema.String,
    request_id: Schema.String,
    response: Schema.optionalKey(Schema.Unknown),
    error: Schema.optionalKey(Schema.String),
  }),
});

const Init = Schema.Struct({
  type: Schema.Literal("system"),
  subtype: Schema.Literal("init"),
  tools: Schema.Array(Schema.String),
  model: Schema.String,
});

const Assistant = Schema.Struct({
  type: Schema.Literal("assistant"),
  message: Schema.Struct({
    id: Schema.String,
    content: Schema.Array(Schema.Unknown),
  }),
});

const User = Schema.Struct({
  type: Schema.Literal("user"),
  message: Schema.Struct({ content: Schema.Unknown }),
});

const Result = Schema.Struct({
  type: Schema.Literal("result"),
  subtype: Schema.String,
  is_error: Schema.Boolean,
  num_turns: Schema.optionalKey(Schema.Int),
  total_cost_usd: Schema.optionalKey(Schema.Finite),
  result: Schema.optionalKey(Schema.String),
});

const TextBlock = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
});
const ToolUse = Schema.Struct({
  type: Schema.Literal("tool_use"),
  name: Schema.String,
  input: Schema.Unknown,
});
const ToolResult = Schema.Struct({
  type: Schema.Literal("tool_result"),
  content: Schema.Union([Schema.String, Schema.Array(Schema.Unknown)]),
  is_error: Schema.optionalKey(Schema.Boolean),
});

/** One line the client printed, as the harness reads it: its output is untrusted text, read only through these Schemas. */
export type Line =
  | {
      readonly kind: "control";
      readonly id: string;
      readonly ok: boolean;
      readonly response: unknown;
      readonly error: string | null;
    }
  | {
      readonly kind: "init";
      readonly tools: ReadonlyArray<string>;
      readonly model: string;
    }
  | {
      readonly kind: "assistant";
      readonly id: string;
      readonly content: ReadonlyArray<unknown>;
    }
  | { readonly kind: "user"; readonly content: unknown }
  | {
      readonly kind: "result";
      readonly subtype: string;
      readonly isError: boolean;
      readonly turns: number | null;
      readonly costUsd: number | null;
      readonly text: string;
    }
  | { readonly kind: "other" };

const decodeControl = Schema.decodeUnknownOption(
  Schema.fromJsonString(ControlResponse),
);
const decodeInit = Schema.decodeUnknownOption(Schema.fromJsonString(Init));
const decodeAssistant = Schema.decodeUnknownOption(
  Schema.fromJsonString(Assistant),
);
const decodeUser = Schema.decodeUnknownOption(Schema.fromJsonString(User));
const decodeResult = Schema.decodeUnknownOption(Schema.fromJsonString(Result));

export const lineOf = (line: string): Line => {
  const control = Option.getOrUndefined(decodeControl(line));
  if (control !== undefined)
    return {
      kind: "control",
      id: control.response.request_id,
      ok: control.response.subtype === "success",
      response: control.response.response,
      error: control.response.error ?? null,
    };
  const init = Option.getOrUndefined(decodeInit(line));
  if (init !== undefined)
    return { kind: "init", tools: init.tools, model: init.model };
  const assistant = Option.getOrUndefined(decodeAssistant(line));
  if (assistant !== undefined)
    return {
      kind: "assistant",
      id: assistant.message.id,
      content: assistant.message.content,
    };
  const user = Option.getOrUndefined(decodeUser(line));
  if (user !== undefined)
    return { kind: "user", content: user.message.content };
  const result = Option.getOrUndefined(decodeResult(line));
  if (result !== undefined)
    return {
      kind: "result",
      subtype: result.subtype,
      isError: result.is_error,
      turns: result.num_turns ?? null,
      costUsd: result.total_cost_usd ?? null,
      text: result.result ?? "",
    };
  return { kind: "other" };
};

/** What a context-usage answer announces: each MCP tool by name, each subagent, and each part of the context that is not a known part without tools. */
export const announcedOfContext = (
  response: unknown,
): ReadonlyArray<string> | null => {
  const usage = Option.getOrUndefined(
    Schema.decodeUnknownOption(ContextUsage)(response),
  );
  if (usage === undefined) return null;
  return [
    ...usage.mcpTools.map(({ name }) => name),
    ...usage.categories
      .filter(({ name }) => !toollessParts.includes(name))
      .map(({ name }) => `the part "${name}" of its context`),
    ...usage.agents.map((_, at) => `subagent ${at + 1}`),
  ];
};

/** The tools an init line announced, from the lines a client printed; undefined when it printed none. */
export const announcedTools = (
  printed: string,
): ReadonlyArray<string> | undefined => {
  for (const line of printed.split("\n")) {
    const read = lineOf(line);
    if (read.kind === "init") return read.tools;
  }
  return undefined;
};

const decodeText = Schema.decodeUnknownOption(TextBlock);
const decodeToolUse = Schema.decodeUnknownOption(ToolUse);
const decodeToolResult = Schema.decodeUnknownOption(ToolResult);

export const textOfBlock = (block: unknown) =>
  Option.getOrUndefined(decodeText(block))?.text;
export const toolUseOf = (block: unknown) =>
  Option.getOrUndefined(decodeToolUse(block));
export const toolResultOf = (block: unknown) => {
  const result = Option.getOrUndefined(decodeToolResult(block));
  if (result === undefined) return undefined;
  const text =
    typeof result.content === "string"
      ? result.content
      : result.content.map((part) => textOfBlock(part) ?? "").join("\n");
  return { text, isError: result.is_error ?? false };
};
