/** The clients `cota` launches, by their commands. */
export const commands = ["claude", "codex", "opencode", "pi"] as const;
export type Command = (typeof commands)[number];

/** The clients the hub routes to a pool: their pool is a route's, the default pool or an override. */
export const routedCommands = ["claude", "codex"] as const;
export type RoutedCommand = (typeof routedCommands)[number];

export const isRouted = (command: Command): command is RoutedCommand =>
  command === "claude" || command === "codex";

/** A routed client as the hub names it. */
export type RoutedClient = "claude-code" | "codex";

export const routedClientOf: Readonly<Record<RoutedCommand, RoutedClient>> = {
  claude: "claude-code",
  codex: "codex",
};

/** The protocol of the pools a routed client is routed to. */
export const protocolOf: Readonly<Record<RoutedCommand, string>> = {
  claude: "anthropic-messages",
  codex: "chatgpt-codex",
};
