const known: ReadonlyArray<readonly [RegExp, string]> = [
  [/^claude-cli\//, "claude-code"],
  [/^codex/, "codex"],
  [/^opencode\//, "opencode"],
  [/^pi\//, "pi"],
];

/** The names the hub gives the clients it knows (`docs/specs/display-names/spec.md`). */
export const names: ReadonlyArray<readonly [client: string, name: string]> = [
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
 * gives the version of the user agent's first product.
 */
export const of = (tag: string, userAgent: string): Client => {
  const agent = userAgent.trim();
  const product = /^([^\s/]+)(?:\/(\S+))?/.exec(agent);
  const version = product?.[2] ?? "";
  if (tag !== "") return { client: tag, version };
  const name = known.find(([pattern]) => pattern.test(agent))?.[1];
  return {
    client: name ?? product?.[1]?.toLowerCase() ?? "unknown",
    version,
  };
};
