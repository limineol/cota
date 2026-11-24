import { Duration, Option, Redacted } from "effect";
import {
  type Command,
  isRouted,
  type RoutedCommand,
  routedClientOf,
} from "./client.ts";
import type { Configuration } from "./configuration.ts";
import type { HubKeys } from "./machine.ts";
import type { Asked, KeptAnswer, RoutedPool } from "./route.ts";
import type { System, Variables } from "./system.ts";

/** What a launch was given: the client's arguments and the environment `cota` was started with. */
export interface Given {
  readonly args: ReadonlyArray<string>;
  readonly variables: Variables;
}

/** What a launch knows of a machine that has joined a hub. */
export interface Joined {
  readonly configuration: Configuration;
  readonly project: string;
  readonly hubKeys: HubKeys;
  /** The machine logins, by pool. */
  readonly logins: ReadonlyMap<string, Redacted.Redacted<string>>;
  /** The pool `--pool` or `COTA_POOL` named, which the hub was asked in place of the route, and which the client is given as `COTA_POOL`. */
  readonly override: Option.Option<string>;
  /** What the hub answered by the deadline; none for a client the hub does not route. */
  readonly asked: Option.Option<Asked>;
  /** The answer kept for this client and project. */
  readonly kept: Option.Option<KeptAnswer>;
}

export interface Launch {
  readonly command: Command;
  readonly given: Given;
  /** The client's real command, the first on `PATH` beyond the shims that is not a shim. */
  readonly realClient: Option.Option<string>;
  /** None on a machine that has not joined. */
  readonly machine: Option.Option<Joined>;
}

/** What a launch comes to: exactly one of starting the client, or stopping with a line and an exit status. */
export type Decision =
  | {
      readonly _tag: "Start";
      readonly command: string;
      readonly args: ReadonlyArray<string>;
      readonly variables: Variables;
      /** The one line `cota` says before the start, going direct. */
      readonly notice: Option.Option<string>;
      /** The pool the client reaches through the hub; none for a start that does not go through the hub. */
      readonly throughHub: Option.Option<string>;
    }
  | { readonly _tag: "Stop"; readonly line: string; readonly status: number };

/** Exit statuses of a launch that stops (`docs/specs/cli/spec.md`, Commands). */
export const stopped = 1;
export const notInstalled = 127;

const defaultWait = Duration.seconds(5);
const defaultWaitRouted = Duration.seconds(40);

const stop = (line: string, status = stopped): Decision => ({
  _tag: "Stop",
  line,
  status,
});

/** Whether the owner asked for the bypass: `COTA=off`. */
export const isBypass = (variables: Variables): boolean =>
  variables.COTA === "off";

const pathSeparatorOf = (system: System) => (system === "win32" ? ";" : ":");

const sameDirectory = (system: System, one: string, other: string) => {
  const trimmed = (path: string) =>
    path.replace(system === "win32" ? /[\\/]+$/ : /\/+$/, "");
  return system === "win32"
    ? trimmed(one).toLowerCase() === trimmed(other).toLowerCase()
    : trimmed(one) === trimmed(other);
};

/** `PATH` without the shims' directory, and without empty entries. */
export const pathWithout = (
  system: System,
  path: string,
  shims: string,
): ReadonlyArray<string> =>
  path
    .split(pathSeparatorOf(system))
    .filter((entry) => entry !== "" && !sameDirectory(system, entry, shims));

/** A tag's value as one header line: every line break and control character a space. */
export const tagOf = (value: string): string =>
  value.replace(/[\p{Cc}\u2028\u2029]/gu, " ");

/** The client's own pool on this machine: the configuration's, else the client's default pool as the hub last answered it. */
export const ownPoolOf = (
  command: RoutedCommand,
  configuration: Configuration,
  defaultPool: Option.Option<string>,
): Option.Option<string> => {
  const configured = configuration.clients?.[routedClientOf[command]]?.own_pool;
  return configured === undefined ? defaultPool : Option.some(configured);
};

/** How long a launch waits for the hub: `launch.wait_routed` when the kept answer names a pool other than the client's own, else `launch.wait`. */
export const deadlineOf = (
  command: RoutedCommand,
  configuration: Configuration,
  kept: Option.Option<KeptAnswer>,
): Duration.Duration => {
  const routedElsewhere = Option.match(kept, {
    onNone: () => false,
    onSome: (answer) =>
      !Option.contains(
        ownPoolOf(
          command,
          configuration,
          Option.fromNullOr(answer.defaultPool),
        ),
        answer.pool.id,
      ),
  });
  return routedElsewhere
    ? (configuration.launch?.wait_routed ?? defaultWaitRouted)
    : (configuration.launch?.wait ?? defaultWait);
};

const without = (
  variables: Variables,
  names: ReadonlyArray<string>,
): Record<string, string | undefined> => {
  const kept: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(variables)) {
    if (!names.includes(name) && value !== undefined) kept[name] = value;
  }
  return kept;
};

const isCotaHeader = (line: string) => /^\s*x-cota-/i.test(line);

const ownersHeaders = (variables: Variables): ReadonlyArray<string> =>
  (variables.ANTHROPIC_CUSTOM_HEADERS ?? "")
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "" && !isCotaHeader(line));

const loginVariables = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
];

/** The login Claude Code spends: its own, or a machine login. */
type ClaudeLogin =
  | { readonly _tag: "Own" }
  | { readonly _tag: "Machine"; readonly login: Redacted.Redacted<string> };

const withClaudeLogin = (
  variables: Record<string, string | undefined>,
  login: ClaudeLogin,
): Record<string, string | undefined> => {
  const set = without(variables, loginVariables);
  if (login._tag === "Machine") {
    set.CLAUDE_CODE_OAUTH_TOKEN = Redacted.value(login.login);
  }
  return set;
};

/** The line a launch, or `cota route`, says when the hub refuses the route it asked for. */
export const refusedLine = (
  command: RoutedCommand,
  project: string,
  refused: Extract<Asked, { readonly _tag: "Refused" }>,
  overridden: boolean,
): string =>
  refused.refusal === "no-route"
    ? `cota: no route of ${routedClientOf[command]} matches ${project}, and it has no default pool. Add one in Settings → Routes.`
    : `cota: ${refused.detail} ${overridden ? "Name another pool." : "Change the route in Settings → Routes."}`;

/**
 * Decides a launch (`docs/specs/cli/spec.md`, Launching, steps 1 to 7, and
 * Going direct): the bypass starts the client untouched; otherwise the
 * client is started with its pool's login, through the hub where it answered
 * and directly where it could not be reached, or the launch stops.
 */
export const decide = (launch: Launch): Decision => {
  const { command, given } = launch;
  if (Option.isNone(launch.realClient)) {
    return stop(
      `cota: ${command} is not installed: no ${command} on PATH beyond cota's shims.`,
      notInstalled,
    );
  }
  const real = launch.realClient.value;
  if (isBypass(given.variables) || Option.isNone(launch.machine)) {
    return {
      _tag: "Start",
      command: real,
      args: given.args,
      variables: given.variables,
      notice: Option.none(),
      throughHub: Option.none(),
    };
  }
  const machine = launch.machine.value;
  const { configuration, project } = machine;
  const hub = configuration.hub;
  const base: Record<string, string | undefined> = {
    ...without(given.variables, []),
    COTA_PROJECT: project,
  };
  if (Option.isSome(machine.override)) {
    base.COTA_POOL = machine.override.value;
  }
  const start = (
    variables: Variables,
    args: ReadonlyArray<string>,
    throughHub: Option.Option<string>,
    notice: Option.Option<string> = Option.none(),
  ): Decision => ({
    _tag: "Start",
    command: real,
    args,
    variables,
    notice,
    throughHub,
  });

  if (!isRouted(command)) return start(base, given.args, Option.none());

  const keyed = machine.hubKeys.keyed;
  const loginFor = (
    pool: RoutedPool,
    own: Option.Option<string>,
  ): ClaudeLogin | string => {
    if (Option.contains(own, pool.id)) return { _tag: "Own" };
    if (command === "codex") {
      return `cota: ${project} bills ${pool.id}, and Codex on this machine spends ${Option.getOrElse(own, () => "its own login's pool")}; cota cannot give Codex another ChatGPT login.`;
    }
    const login = machine.logins.get(pool.id);
    return login === undefined
      ? `cota: ${project} bills ${pool.id}, and this machine has no login for it. Sign in to ${pool.id}'s subscription with claude setup-token, then run cota login ${pool.id}.`
      : { _tag: "Machine", login };
  };
  const keyedMissing = (pool: RoutedPool) =>
    `cota: ${project} bills ${pool.id}, whose key the hub holds, and this machine has no keyed hub key. Join again with one: cota join ${hub}.`;

  const throughHub = (
    pool: RoutedPool,
    own: Option.Option<string>,
  ): Decision => {
    if (pool.kind === "keyed" && Option.isNone(keyed)) {
      return stop(keyedMissing(pool));
    }
    const login =
      pool.kind === "subscription" ? loginFor(pool, own) : undefined;
    if (typeof login === "string") return stop(login);
    if (command === "codex") {
      return start(
        base,
        ["-c", `model_provider="cota-${pool.id}"`, ...given.args],
        Option.some(pool.id),
      );
    }
    const headers = [
      ...ownersHeaders(given.variables),
      ...(pool.kind === "subscription"
        ? Option.match(machine.hubKeys.subscription, {
            onNone: () => [],
            onSome: (key) => [`x-cota-key: ${Redacted.value(key)}`],
          })
        : []),
      `x-cota-project: ${tagOf(project)}`,
      `x-cota-machine: ${tagOf(configuration.machine)}`,
      "x-cota-client: claude-code",
    ];
    const variables =
      login === undefined
        ? without(base, loginVariables)
        : withClaudeLogin(base, login);
    if (pool.kind === "keyed" && Option.isSome(keyed)) {
      const key = Redacted.value(keyed.value);
      if (pool.provider === "anthropic") {
        variables.ANTHROPIC_API_KEY = key;
      } else {
        variables.ANTHROPIC_AUTH_TOKEN = key;
        variables.ANTHROPIC_API_KEY = "";
      }
    }
    variables.ANTHROPIC_BASE_URL = `${hub}/pools/${pool.id}`;
    variables.ANTHROPIC_CUSTOM_HEADERS = headers.join("\n");
    variables.CLAUDE_CODE_GATEWAY_HINT_HEADERS = "1";
    return start(variables, given.args, Option.some(pool.id));
  };

  const direct = (login: ClaudeLogin, notice: string): Decision => {
    if (command === "codex") {
      return start(base, given.args, Option.none(), Option.some(notice));
    }
    const variables = withClaudeLogin(base, login);
    if (variables.ANTHROPIC_BASE_URL?.startsWith(`${hub}/pools/`) === true) {
      delete variables.ANTHROPIC_BASE_URL;
    }
    const headers = ownersHeaders(given.variables);
    if (headers.length === 0) delete variables.ANTHROPIC_CUSTOM_HEADERS;
    else variables.ANTHROPIC_CUSTOM_HEADERS = headers.join("\n");
    return start(variables, given.args, Option.none(), Option.some(notice));
  };

  const goingDirect = (): Decision => {
    if (Option.isNone(machine.kept)) {
      return direct(
        { _tag: "Own" },
        `cota: ${hub} cannot be reached, and ${command} has not been launched in ${project} on this machine before; it goes direct with its own login, unlogged.`,
      );
    }
    const kept = machine.kept.value;
    if (kept.pool.kind === "keyed") {
      return stop(
        `cota: ${hub} cannot be reached, and ${project} bills ${kept.pool.id}, whose key only the hub holds; ${command} did not start.`,
      );
    }
    const login = loginFor(
      kept.pool,
      ownPoolOf(command, configuration, Option.fromNullOr(kept.defaultPool)),
    );
    if (typeof login === "string") return stop(login);
    return direct(
      login,
      `cota: ${hub} cannot be reached; ${command} goes direct with ${kept.pool.id}'s login, unlogged and with no fallback.`,
    );
  };

  const asked = Option.getOrElse(
    machine.asked,
    (): Asked => ({ _tag: "Unreachable" }),
  );
  switch (asked._tag) {
    case "Answered":
      return throughHub(
        asked.answer.pool,
        ownPoolOf(command, configuration, asked.answer.defaultPool),
      );
    case "Refused":
      return stop(
        refusedLine(command, project, asked, Option.isSome(machine.override)),
      );
    case "KeyUnknown":
      return stop(
        `cota: ${hub} does not know this machine's hub key; ${command} did not start. Join again: cota join ${hub}.`,
      );
    case "NoHubKey":
      return stop(
        `cota: this machine keeps no hub key; ${command} did not start. Join again: cota join ${hub}.`,
      );
    case "Unsure":
      return Option.match(machine.kept, {
        onNone: () =>
          stop(
            `cota: ${hub} could not say which pool ${project} bills, and no answer is kept for it; ${command} did not start.`,
          ),
        onSome: (kept) =>
          throughHub(
            kept.pool,
            ownPoolOf(
              command,
              configuration,
              Option.fromNullOr(kept.defaultPool),
            ),
          ),
      });
    case "Unreachable":
      return goingDirect();
  }
};
