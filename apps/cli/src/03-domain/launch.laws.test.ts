import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Redacted, Result, Schema } from "effect";
import { isRouted, routedClientOf } from "./client.ts";
import type { Configuration } from "./configuration.ts";
import * as HubAddress from "./hub-address.ts";
import * as Launch from "./launch.ts";
import type { Asked, KeptAnswer, RoutedPool } from "./route.ts";
import { System } from "./system.ts";

const hub = Result.getOrThrow(HubAddress.read("http://127.0.0.1:18080", false));

const pools = {
  personal: {
    id: "personal",
    kind: "subscription",
    protocol: "anthropic-messages",
    provider: "anthropic",
  },
  team: {
    id: "team",
    kind: "subscription",
    protocol: "anthropic-messages",
    provider: "anthropic",
  },
  console: {
    id: "console",
    kind: "keyed",
    protocol: "anthropic-messages",
    provider: "anthropic",
  },
  zai: {
    id: "zai",
    kind: "keyed",
    protocol: "anthropic-messages",
    provider: "zai",
  },
  chatgpt: {
    id: "chatgpt",
    kind: "subscription",
    protocol: "chatgpt-codex",
    provider: "openai",
  },
  "chatgpt-team": {
    id: "chatgpt-team",
    kind: "subscription",
    protocol: "chatgpt-codex",
    provider: "openai",
  },
} satisfies Record<string, RoutedPool>;

const poolIds = Object.keys(pools) as ReadonlyArray<keyof typeof pools>;
const PoolId = Schema.Literals(poolIds);
const MaybePool = Schema.Literals(["none", ...poolIds]);

const subscriptionKey = "cota_sub_9f3a71c0d2e4b6a8";
const keyedKey = "cota_key_17e5c3a9b0d2f4e6";
const loginOf = (pool: string) => `sk-ant-oat01-machine-${pool}-4c7e`;
const secrets = [
  subscriptionKey,
  keyedKey,
  ...poolIds.map((pool) => loginOf(pool)),
];

/** A launch in any state: the client, what it was given, and, on a machine that has joined, everything the decision reads. */
const Drawn = Schema.Struct({
  command: Schema.Literals(["claude", "codex", "opencode", "pi"]),
  system: System,
  installed: Schema.Boolean,
  joined: Schema.Boolean,
  cota: Schema.Literals(["absent", "absent", "off", "on", "OFF"]),
  args: Schema.Array(
    Schema.Literals(["a b", "--resume", "", "-c", 'x="1"', "--pool", "é"]),
  ),
  inheritedLogins: Schema.Array(
    Schema.Literals([
      "CLAUDE_CODE_OAUTH_TOKEN",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
    ]),
  ),
  inheritedBaseUrl: Schema.Literals(["absent", "hub", "other"]),
  inheritedHeaders: Schema.Literals(["absent", "owner", "owner and cota"]),
  ownPool: MaybePool,
  subscriptionKey: Schema.Boolean,
  keyedKey: Schema.Boolean,
  logins: Schema.Array(PoolId),
  override: MaybePool,
  asked: Schema.Literals([
    "Answered",
    "Answered",
    "Answered",
    "Refused",
    "KeyUnknown",
    "NoHubKey",
    "Unsure",
    "Unreachable",
    "Unreachable",
  ]),
  answerPool: PoolId,
  answerDefault: MaybePool,
  kept: MaybePool,
  keptDefault: MaybePool,
});
type Drawn = typeof Drawn.Type;

const shimsOf = (system: System) =>
  system === "win32"
    ? "C:\\Users\\me\\AppData\\Local\\cota\\bin"
    : "/home/me/.local/share/cota/bin";

const givenOf = (drawn: Drawn): Launch.Given => {
  const separator = drawn.system === "win32" ? ";" : ":";
  const variables: Record<string, string> = {
    HOME: "/home/me",
    PATH: [shimsOf(drawn.system), "/usr/bin", ""].join(separator),
    TERM: "xterm-256color",
  };
  if (drawn.cota !== "absent") variables.COTA = drawn.cota;
  for (const name of drawn.inheritedLogins) {
    variables[name] = `the person's own ${name}`;
  }
  if (drawn.inheritedBaseUrl === "hub") {
    variables.ANTHROPIC_BASE_URL = `${hub}/pools/personal`;
  }
  if (drawn.inheritedBaseUrl === "other") {
    variables.ANTHROPIC_BASE_URL = "https://gateway.example";
  }
  if (drawn.inheritedHeaders !== "absent") {
    variables.ANTHROPIC_CUSTOM_HEADERS =
      drawn.inheritedHeaders === "owner"
        ? "x-team: platform"
        : "x-team: platform\nx-cota-project: elsewhere";
  }
  return { args: drawn.args, variables };
};

const optional = (pool: Drawn["ownPool"]): Option.Option<string> =>
  pool === "none" ? Option.none() : Option.some(pool);

const askedOf = (drawn: Drawn, project: string): Asked => {
  switch (drawn.asked) {
    case "Answered":
      return {
        _tag: "Answered",
        answer: {
          project,
          pool: pools[drawn.answerPool],
          by:
            drawn.override === "none"
              ? { _tag: "Route", position: 1, pattern: "acme/*" }
              : { _tag: "Override" },
          defaultPool: optional(drawn.answerDefault),
        },
      };
    case "Refused":
      return {
        _tag: "Refused",
        refusal: "pool-not-for-client",
        detail: `${drawn.answerPool} is not a pool for this client.`,
      };
    case "KeyUnknown":
    case "NoHubKey":
    case "Unsure":
    case "Unreachable":
      return { _tag: drawn.asked };
  }
};

const configurationOf = (drawn: Drawn): Configuration => ({
  hub,
  machine: "studio",
  ...(drawn.ownPool === "none"
    ? {}
    : {
        clients: {
          "claude-code": { own_pool: drawn.ownPool },
          codex: { own_pool: drawn.ownPool },
        },
      }),
});

const launchOf = (drawn: Drawn): Launch.Launch => {
  const project = "acme/api";
  const command = drawn.command;
  const routed = isRouted(command);
  const kept: Option.Option<KeptAnswer> =
    isRouted(command) && drawn.kept !== "none"
      ? Option.some({
          client: routedClientOf[command],
          project,
          pool: pools[drawn.kept],
          defaultPool: drawn.keptDefault === "none" ? null : drawn.keptDefault,
        })
      : Option.none();
  return {
    command: drawn.command,
    system: drawn.system,
    given: givenOf(drawn),
    realClient: drawn.installed
      ? Option.some(`/usr/bin/${drawn.command}`)
      : Option.none(),
    machine: drawn.joined
      ? Option.some({
          configuration: configurationOf(drawn),
          project,
          shims: shimsOf(drawn.system),
          hubKeys: {
            subscription: drawn.subscriptionKey
              ? Option.some(Redacted.make(subscriptionKey))
              : Option.none(),
            keyed: drawn.keyedKey
              ? Option.some(Redacted.make(keyedKey))
              : Option.none(),
          },
          logins: new Map(
            drawn.logins.map((pool) => [pool, Redacted.make(loginOf(pool))]),
          ),
          override: optional(drawn.override),
          asked: routed ? Option.some(askedOf(drawn, project)) : Option.none(),
          kept,
        })
      : Option.none(),
  };
};

/**
 * The pool a launch spends, read from what it was given rather than from the
 * decision: the hub's answer, else the kept answer where the hub could not
 * say or be reached; and the client's own pool beside it, the configuration's,
 * else the default pool of that answer. None where no pool is known.
 */
const spentOf = (
  drawn: Drawn,
): Option.Option<{
  readonly pool: RoutedPool;
  readonly own: Option.Option<string>;
}> => {
  if (
    !drawn.installed ||
    !drawn.joined ||
    drawn.cota === "off" ||
    !isRouted(drawn.command)
  ) {
    return Option.none();
  }
  const own = (defaultPool: Drawn["ownPool"]) =>
    optional(drawn.ownPool === "none" ? defaultPool : drawn.ownPool);
  if (drawn.asked === "Answered") {
    return Option.some({
      pool: pools[drawn.answerPool],
      own: own(drawn.answerDefault),
    });
  }
  if (
    (drawn.asked === "Unsure" || drawn.asked === "Unreachable") &&
    drawn.kept !== "none"
  ) {
    return Option.some({
      pool: pools[drawn.kept],
      own: own(drawn.keptDefault),
    });
  }
  return Option.none();
};

const loginVariables = [
  "CLAUDE_CODE_OAUTH_TOKEN",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
] as const;

const drawn = Arbitrary.schema(Drawn);
const runs = { arbitrary: { runs: 2000 } };

describe("launch laws", () => {
  it.effect.prop(
    "J6: A launch to a subscription pool starts its client with the own login only when the pool is the own pool, with a machine login only when it is that login's pool, and otherwise not at all.",
    { drawn },
    ({ drawn }) =>
      Effect.sync(() => {
        const decision = Launch.decide(launchOf(drawn));
        const spent = spentOf(drawn);
        if (
          decision._tag === "Stop" ||
          Option.isNone(spent) ||
          spent.value.pool.kind !== "subscription"
        ) {
          return;
        }
        const { pool, own } = spent.value;
        if (drawn.command === "codex") {
          expect(Option.getOrNull(own)).toBe(pool.id);
          return;
        }
        const set = loginVariables.filter(
          (name) => decision.variables[name] !== undefined,
        );
        if (set.length === 0) {
          expect(Option.getOrNull(own)).toBe(pool.id);
        } else {
          expect(set).toEqual(["CLAUDE_CODE_OAUTH_TOKEN"]);
          expect(decision.variables.CLAUDE_CODE_OAUTH_TOKEN).toBe(
            loginOf(pool.id),
          );
          expect(drawn.logins).toContain(pool.id);
        }
      }),
    runs,
  );

  it.effect.prop(
    "J7: No launch whose pool is keyed starts its client without the hub's address.",
    { drawn },
    ({ drawn }) =>
      Effect.sync(() => {
        const decision = Launch.decide(launchOf(drawn));
        const spent = spentOf(drawn);
        if (
          decision._tag === "Stop" ||
          Option.isNone(spent) ||
          spent.value.pool.kind !== "keyed"
        ) {
          return;
        }
        const { pool } = spent.value;
        expect(decision.throughHub).toEqual(Option.some(pool.id));
        if (drawn.command === "codex") {
          expect(decision.args.slice(0, 2)).toEqual([
            "-c",
            `model_provider="cota-${pool.id}"`,
          ]);
        } else {
          expect(decision.variables.ANTHROPIC_BASE_URL).toBe(
            `${hub}/pools/${pool.id}`,
          );
        }
      }),
    runs,
  );

  it.effect.prop(
    "J8: With `COTA=off`, or on a machine that has not joined, the client gets exactly the environment and arguments the launch was given.",
    { drawn },
    ({ drawn }) =>
      Effect.sync(() => {
        if (!drawn.installed || (drawn.cota !== "off" && drawn.joined)) return;
        const launch = launchOf(drawn);
        expect(Launch.decide(launch)).toEqual({
          _tag: "Start",
          command: `/usr/bin/${drawn.command}`,
          args: launch.given.args,
          variables: launch.given.variables,
          notice: Option.none(),
          throughHub: Option.none(),
        });
      }),
    runs,
  );

  it.effect.prop(
    "J9: No launch, shim, schedule or rewrite puts a hub key or a login in any command's arguments, and no command but `cota hub-key keyed` prints one.",
    { drawn },
    ({ drawn }) =>
      Effect.sync(() => {
        const decision = Launch.decide(launchOf(drawn));
        const said =
          decision._tag === "Stop"
            ? [decision.line]
            : [
                decision.command,
                ...decision.args,
                ...Option.toArray(decision.notice),
              ];
        for (const secret of secrets) {
          for (const each of said) expect(each).not.toContain(secret);
        }
      }),
    runs,
  );

  it("a launch with no real client stops with 127, whatever else it was given", () => {
    const decision = Launch.decide({
      command: "claude",
      system: "darwin",
      given: { args: [], variables: { COTA: "off" } },
      realClient: Option.none(),
      machine: Option.none(),
    });
    expect(decision).toEqual({
      _tag: "Stop",
      line: "cota: claude is not installed: no claude on PATH beyond cota's shims.",
      status: Launch.notInstalled,
    });
  });

  it("waits launch.wait_routed only when the kept answer names a pool other than the own pool", () => {
    const configuration: Configuration = { hub, machine: "studio" };
    const keptOn = (pool: keyof typeof pools, defaultPool: string | null) =>
      Option.some({
        client: "claude-code" as const,
        project: "acme/api",
        pool: pools[pool],
        defaultPool,
      });
    expect(
      Launch.deadlineOf(
        "claude",
        configuration,
        keptOn("personal", "personal"),
      ),
    ).toEqual(Launch.deadlineOf("claude", configuration, Option.none()));
    expect(
      Launch.deadlineOf("claude", configuration, keptOn("team", "personal")),
    ).not.toEqual(Launch.deadlineOf("claude", configuration, Option.none()));
  });
});
