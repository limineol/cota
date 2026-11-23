import { Schema } from "effect";

const known: ReadonlyArray<readonly [RegExp, string]> = [
  [/^claude-cli\//, "claude-code"],
  [/^codex/, "codex"],
  [/^opencode\//, "opencode"],
  [/^pi\//, "pi"],
];

/** The clients a machine reports and the hub never forwards for (ADR-0029). */
export const ReportedClient = Schema.Literals(["antigravity"]);
export type ReportedClient = typeof ReportedClient.Type;

const isReported = (name: string): boolean =>
  Schema.is(ReportedClient)(name.toLowerCase());

/** The names the hub gives the clients it knows (`docs/specs/display-names/spec.md`). */
export const names: ReadonlyArray<readonly [client: string, name: string]> = [
  ["antigravity", "Antigravity"],
  ["claude-code", "Claude Code"],
  ["codex", "Codex"],
  ["opencode", "OpenCode"],
  ["pi", "Pi"],
];

export interface Client {
  readonly client: string;
  readonly version: string;
}

/**
 * Names the client by its `x-cota-client` tag, else by its user agent, and
 * gives the version of the user agent's first product. A forwarded request
 * never claims a reported client: a tag naming one, in any case, is passed
 * over, and a user agent naming one names no client (R7).
 */
export const of = (tag: string, userAgent: string): Client => {
  const agent = userAgent.trim();
  const product = /^([^\s/]+)(?:\/(\S+))?/.exec(agent);
  const version = product?.[2] ?? "";
  if (tag !== "" && !isReported(tag)) return { client: tag, version };
  const name =
    known.find(([pattern]) => pattern.test(agent))?.[1] ??
    product?.[1]?.toLowerCase();
  return {
    client: name === undefined || isReported(name) ? "unknown" : name,
    version,
  };
};
