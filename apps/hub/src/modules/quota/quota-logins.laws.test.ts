import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "@effect/vitest";
import {
  Arbitrary,
  Context,
  DateTime,
  Duration,
  Effect,
  Exit,
  HashMap,
  Layer,
  Logger,
  Option,
  Redacted,
  Scope,
} from "effect";
import { TestClock } from "effect/testing";
import * as Hub from "#hub.ts";
import { ForgetQuotaLogin } from "#modules/quota/02-application/commands/forget-quota-login.command.ts";
import { GiveQuotaLogin } from "#modules/quota/02-application/commands/give-quota-login.command.ts";
import { KeepQuotaLoginsAlive } from "#modules/quota/02-application/commands/keep-quota-logins-alive.command.ts";
import { ReadQuota } from "#modules/quota/02-application/commands/read-quota.command.ts";
import { QuotaLogins } from "#modules/quota/02-application/interfaces/quota-logins.ts";
import type { Refreshed } from "#modules/quota/02-application/interfaces/token-endpoints.ts";
import * as QuotaLogin from "#modules/quota/03-domain/quota-login.ts";
import * as Readers from "#modules/quota/03-domain/readers.ts";
import { ReadFailure } from "#modules/quota/03-domain/readings.ts";
import * as SqliteQuotaLogins from "#modules/quota/04-infrastructure/persistence/sqlite/sqlite-quota-logins.ts";
import * as InMemoryQuotaLogins from "#modules/quota/05-tests/fakes/in-memory-quota-logins.ts";
import * as ScriptedQuotaReader from "#modules/quota/05-tests/fakes/scripted-quota-reader.ts";
import * as ScriptedTokenEndpoints from "#modules/quota/05-tests/fakes/scripted-token-endpoints.ts";
import * as QuotaLog from "#modules/quota/05-tests/quota-log.ts";
import { jwt } from "#modules/quota/05-tests/quota-logins.ts";
import * as Quota from "#modules/quota/module.ts";
import { RequestLogReader } from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import * as InMemoryRequestLogReader from "#modules/request-log/05-tests/fakes/in-memory-request-log-reader.ts";
import * as RequestLog from "#modules/request-log/module.ts";
import { PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import * as HubStore from "#shared/04-infrastructure/hub-store/hub-store.ts";

const scratch = mkdtempSync(join(tmpdir(), "cota-quota-logins-laws-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let stores = 0;
const freshPath = () => {
  stores += 1;
  return join(scratch, `${stores}.sqlite`);
};

const second = 1000;
const minute = 60 * second;
const hour = 60 * minute;
const fresh = 5 * minute;

type PoolName = "claude" | "codex";

const poolsById = HashMap.fromIterable(
  QuotaLog.pools.map((pool) => [pool.id, pool]),
);
const poolOf = (name: PoolName): Pool.Pool =>
  Option.getOrThrow(HashMap.get(poolsById, PoolId.make(name)));

/** How a call to a token endpoint ends, and after how long. */
type TokenOutcome =
  | {
      readonly _tag: "Good";
      readonly ms: number;
      readonly rotates: boolean;
      readonly lifeMs: number;
    }
  | { readonly _tag: "Refused"; readonly ms: number }
  | { readonly _tag: "Failed"; readonly ms: number };

/** How a call to a usage endpoint ends, and after how long. */
type UsageOutcome = {
  readonly _tag: "Good" | "Unauthorized" | "Failed";
  readonly ms: number;
};

/** A step of a scene. A move to `due` lands 5 minutes before the soonest end of a kept access token, to `hour` on the next keep-alive check, to `end` on the soonest end of a call in flight; each nudged by a millisecond or not. */
type Step =
  | { readonly _tag: "Give"; readonly pool: PoolName; readonly lifeMs: number }
  | { readonly _tag: "Forget"; readonly pool: PoolName }
  | { readonly _tag: "Read"; readonly pool: PoolName }
  | { readonly _tag: "Keep" }
  | { readonly _tag: "Move"; readonly ms: number }
  | {
      readonly _tag: "MoveTo";
      readonly to: "due" | "hour" | "end";
      readonly nudge: number;
    }
  | { readonly _tag: "Restart" }
  | { readonly _tag: "WritesFail"; readonly fail: boolean };

interface Scene {
  readonly steps: ReadonlyArray<Step>;
  readonly tokens: ReadonlyArray<TokenOutcome>;
  readonly usage: ReadonlyArray<UsageOutcome>;
}

/** What a scene may hold beside gives, forgets and moves. */
interface Flavour {
  readonly reads: boolean;
  readonly restarts: boolean;
  readonly writeFailures: boolean;
  /** Calls answer at once. */
  readonly instant: boolean;
}

const poolName = QuotaLog.pick(["claude", "codex"] as const);
const life = QuotaLog.pick([
  -minute,
  fresh - 1,
  fresh,
  fresh + 1,
  30 * minute,
  hour,
  hour + fresh,
  hour + fresh + 1,
  3 * hour,
]);
const nudge = QuotaLog.pick([-1, 0, 0, 1]);
const duration = (flavour: Flavour) =>
  flavour.instant
    ? QuotaLog.pick([0])
    : QuotaLog.pick([0, 0, 1, 4 * second, 12 * second]);

const stepOf = (flavour: Flavour): Arbitrary.Arbitrary<Step> =>
  Arbitrary.all({
    which: QuotaLog.pick([
      "Give",
      "Give",
      "Forget",
      "Read",
      "Read",
      "Read",
      "Keep",
      "Move",
      "MoveTo",
      "MoveTo",
      "MoveTo",
      "Restart",
      "WritesFail",
    ]),
    pool: poolName,
    lifeMs: life,
    ms: QuotaLog.pick([1, second, 30 * second, 4 * minute, hour]),
    to: QuotaLog.pick(["due", "hour", "end"] as const),
    nudge,
    fail: QuotaLog.pick([true, false]),
  }).pipe(
    Arbitrary.map(({ which, pool, lifeMs, ms, to, nudge, fail }): Step => {
      switch (which) {
        case "Give":
          return { _tag: "Give", pool, lifeMs };
        case "Forget":
          return { _tag: "Forget", pool };
        case "Read":
          return flavour.reads
            ? { _tag: "Read", pool }
            : { _tag: "MoveTo", to: "hour", nudge: 0 };
        case "Keep":
          return flavour.reads
            ? { _tag: "Keep" }
            : { _tag: "MoveTo", to: "due", nudge };
        case "Move":
          return { _tag: "Move", ms };
        case "MoveTo":
          return { _tag: "MoveTo", to, nudge };
        case "Restart":
          return flavour.restarts ? { _tag: "Restart" } : { _tag: "Move", ms };
        default:
          return flavour.writeFailures
            ? { _tag: "WritesFail", fail }
            : { _tag: "Give", pool, lifeMs };
      }
    }),
  );

const tokenOutcomeOf = (flavour: Flavour): Arbitrary.Arbitrary<TokenOutcome> =>
  Arbitrary.all({
    which: QuotaLog.pick(["Good", "Good", "Good", "Good", "Refused", "Failed"]),
    ms: duration(flavour),
    rotates: QuotaLog.pick([true, true, false]),
    lifeMs: QuotaLog.pick([2 * minute, fresh, fresh + 1, hour, 8 * hour]),
  }).pipe(
    Arbitrary.map(({ which, ms, rotates, lifeMs }): TokenOutcome => {
      if (which === "Good") return { _tag: "Good", ms, rotates, lifeMs };
      return { _tag: which, ms };
    }),
  );

const usageOutcomeOf = (flavour: Flavour): Arbitrary.Arbitrary<UsageOutcome> =>
  Arbitrary.all({
    _tag: QuotaLog.pick(["Good", "Good", "Unauthorized", "Failed"]),
    ms: duration(flavour),
  });

/** Generated scenes of a flavour after a prefix that reaches the case a law's mutants break. */
const scenesOf = (
  flavour: Flavour,
  prefix: Scene,
): Arbitrary.Arbitrary<Scene> =>
  Arbitrary.all({
    steps: Arbitrary.array(stepOf(flavour), { minLength: 20, maxLength: 40 }),
    tokens: Arbitrary.array(tokenOutcomeOf(flavour), {
      minLength: 10,
      maxLength: 30,
    }),
    usage: Arbitrary.array(usageOutcomeOf(flavour), {
      minLength: 10,
      maxLength: 30,
    }),
  }).pipe(
    Arbitrary.map((scene) => ({
      steps: [...prefix.steps, ...scene.steps],
      tokens: [...prefix.tokens, ...scene.tokens],
      usage: [...prefix.usage, ...scene.usage],
    })),
  );

/** Generated scenes of either flavour after a prefix. */
const scenes = (
  flavours: readonly [Flavour, Flavour],
  prefix: Scene,
): Arbitrary.Arbitrary<Scene> =>
  Arbitrary.all({
    first: QuotaLog.pick([true, false]),
    one: scenesOf(flavours[0], prefix),
    other: scenesOf(flavours[1], prefix),
  }).pipe(Arbitrary.map(({ first, one, other }) => (first ? one : other)));

/** A call to a token endpoint, as the fake one saw it. */
interface TokenCall {
  readonly pool: PoolId;
  readonly given: number;
  readonly sent: string;
  readonly at: number;
  readonly endsBy: number;
  readonly startSeq: number;
  end?: {
    readonly at: number;
    readonly seq: number;
    readonly outcome: TokenOutcome;
  };
}

/** A call to a usage endpoint, as the fake one saw it. */
interface UsageCall {
  readonly read: number;
  readonly pool: PoolId;
  readonly access: string;
  readonly at: number;
  readonly endsBy: number;
  readonly startSeq: number;
  end?: { readonly seq: number; readonly outcome: UsageOutcome };
}

/** A token the hub was given or a token endpoint issued: whose login it is, when it ends, and when it was issued. */
interface Issued {
  readonly given: number;
  readonly endsAt: number;
  readonly seq: number;
}

/** What the scene did, resolved: each step with the clock's time. */
type Done =
  | {
      readonly _tag: "Give";
      readonly pool: PoolId;
      readonly at: number;
      readonly endsAt: number;
      readonly given: number;
      readonly access: string;
      readonly refresh: string;
    }
  | { readonly _tag: "Forget"; readonly pool: PoolId; readonly at: number }
  | { readonly _tag: "Move"; readonly to: number }
  | { readonly _tag: "Start"; readonly at: number };

const ReadId = Context.Reference<number>("@cota/test/quota-logins/ReadId", {
  defaultValue: () => -1,
});

const start = DateTime.toEpochMillis(QuotaLog.now);

const settle = Effect.gen(function* () {
  for (let turn = 0; turn < 60; turn++) yield* Effect.yieldNow;
});

type Store = "memory" | "sqlite";

/** Plays a scene against the quota module over a store, with fake token and usage endpoints, recording every call they saw. */
const played = (scene: Scene, store: Store) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(start);
    const rows = InMemoryQuotaLogins.Rows.of({
      rows: new Map(),
      writesFail: false,
    });
    const path = freshPath();
    const issued = new Map<string, Issued>();
    const tokenCalls: Array<TokenCall> = [];
    const usageCalls: Array<UsageCall> = [];
    const done: Array<Done> = [];
    const inFlight = new Map<number, number>();
    let mostInFlight = 0;
    let seq = 0;
    let counter = 0;
    const now = () => Effect.map(DateTime.now, DateTime.toEpochMillis);

    const refresh = (login: QuotaLogin.QuotaLogin) =>
      Effect.gen(function* () {
        const sent = Redacted.value(login.refreshToken);
        const owner = issued.get(sent);
        if (owner === undefined) return yield* Effect.die("unknown token");
        const outcome: TokenOutcome = scene.tokens[tokenCalls.length] ?? {
          _tag: "Good",
          ms: 0,
          rotates: true,
          lifeMs: hour,
        };
        const at = yield* now();
        const call: TokenCall = {
          pool: login.pool,
          given: owner.given,
          sent,
          at,
          endsBy: at + outcome.ms,
          startSeq: seq++,
        };
        tokenCalls.push(call);
        const running = (inFlight.get(owner.given) ?? 0) + 1;
        inFlight.set(owner.given, running);
        mostInFlight = Math.max(mostInFlight, running);
        if (outcome.ms > 0) {
          yield* Effect.sleep(Duration.millis(outcome.ms)).pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() =>
                inFlight.set(owner.given, (inFlight.get(owner.given) ?? 1) - 1),
              ),
            ),
          );
        }
        inFlight.set(owner.given, (inFlight.get(owner.given) ?? 1) - 1);
        const ended = yield* now();
        call.end = { at: ended, seq: seq++, outcome };
        if (outcome._tag === "Refused") {
          return yield* new QuotaLogin.RefreshRefused();
        }
        if (outcome._tag === "Failed") {
          return yield* new ReadFailure({
            kind: "failed",
            status: Option.some(503),
            detail: "The token endpoint answered 503.",
            retryAt: Option.none(),
          });
        }
        counter++;
        const access = `access-${counter}`;
        const endsAt = ended + outcome.lifeMs;
        issued.set(access, { given: owner.given, endsAt, seq: call.end.seq });
        const refreshed: Refreshed = {
          accessToken: Redacted.make(access),
          refreshToken: outcome.rotates
            ? Option.some(Redacted.make(`refresh-${counter}`))
            : Option.none(),
          endsAt: DateTime.makeUnsafe(endsAt),
        };
        if (outcome.rotates) {
          issued.set(`refresh-${counter}`, {
            given: owner.given,
            endsAt,
            seq: call.end.seq,
          });
        }
        return refreshed;
      });

    const read = (_pool: Pool.Pool, reader: Readers.Reader) =>
      Effect.gen(function* () {
        if ("key" in reader) return yield* Effect.die("not a login's read");
        const outcome: UsageOutcome = scene.usage[usageCalls.length] ?? {
          _tag: "Good",
          ms: 0,
        };
        const at = yield* now();
        const call: UsageCall = {
          read: yield* ReadId,
          pool: reader.login.pool,
          access: Redacted.value(reader.login.accessToken),
          at,
          endsBy: at + outcome.ms,
          startSeq: seq++,
        };
        usageCalls.push(call);
        if (outcome.ms > 0) yield* Effect.sleep(Duration.millis(outcome.ms));
        call.end = { seq: seq++, outcome };
        if (outcome._tag === "Good") {
          return { windows: [], plan: Option.none() };
        }
        return yield* new ReadFailure({
          kind: outcome._tag === "Unauthorized" ? "refused" : "failed",
          status: Option.some(outcome._tag === "Unauthorized" ? 401 : 503),
          detail: "The usage endpoint refused.",
          retryAt: Option.none(),
        });
      });

    const storeLayer =
      store === "memory"
        ? InMemoryQuotaLogins.over(rows)
        : SqliteQuotaLogins.layer.pipe(
            Layer.provide(
              Layer.orDie(HubStore.layer({ path, steps: Hub.storeSteps })),
            ),
          );
    const moduleLayer = Quota.overPorts(poolsById).pipe(
      Layer.provideMerge(storeLayer),
      Layer.provide([
        ScriptedTokenEndpoints.layer(refresh),
        ScriptedQuotaReader.layer(read),
        RequestLog.quotaSources.pipe(
          Layer.provide(
            Layer.succeed(
              RequestLogReader,
              InMemoryRequestLogReader.make(() => ({
                requests: [],
                requestItems: [],
                items: [],
              })),
            ),
          ),
        ),
      ]),
    );

    const begin = Effect.gen(function* () {
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(moduleLayer, scope);
      done.push({ _tag: "Start", at: yield* now() });
      yield* settle;
      return { scope, context };
    });
    let hub = yield* begin;
    let started = yield* now();

    const kept = () =>
      Context.get(hub.context, QuotaLogins).all.pipe(
        Effect.orElseSucceed(() => []),
      );
    const targetOf = (step: Extract<Step, { _tag: "MoveTo" }>, at: number) =>
      Effect.gen(function* () {
        if (step.to === "hour") {
          return started + (Math.floor((at - started) / hour) + 1) * hour;
        }
        if (step.to === "end") {
          const ends = [...tokenCalls, ...usageCalls].flatMap((call) =>
            call.end === undefined ? [call.endsBy] : [],
          );
          return ends.length === 0 ? at : Math.min(...ends);
        }
        const ends = (yield* kept()).flatMap((login) =>
          Option.isNone(login.expiredAt)
            ? [DateTime.toEpochMillis(login.endsAt) - fresh]
            : [],
        );
        const later = ends.filter((end) => end > at);
        return later.length === 0 ? at : Math.min(...later);
      });

    let reads = 0;
    for (const step of scene.steps) {
      const at = yield* now();
      switch (step._tag) {
        case "Give": {
          counter++;
          const pool = poolOf(step.pool);
          const refreshToken = `refresh-${counter}`;
          const endsAt =
            step.pool === "claude"
              ? at + step.lifeMs
              : Math.floor((at + step.lifeMs) / second) * second;
          const accessToken =
            step.pool === "claude"
              ? `access-${counter}`
              : jwt(Option.some(endsAt / second), `access-${counter}`);
          const given = counter;
          issued.set(accessToken, { given, endsAt, seq: seq++ });
          issued.set(refreshToken, { given, endsAt, seq: seq++ });
          const facts: QuotaLogin.Given =
            step.pool === "claude"
              ? {
                  provider: "anthropic",
                  subscriptionType: Option.some("max"),
                  rateLimitTier: Option.none(),
                  accessToken: Redacted.make(accessToken),
                  refreshToken: Redacted.make(refreshToken),
                  endsAt: Option.some(DateTime.makeUnsafe(endsAt)),
                }
              : {
                  provider: "chatgpt",
                  accountId: Redacted.make("account-5c1e"),
                  accessToken: Redacted.make(accessToken),
                  refreshToken: Redacted.make(refreshToken),
                  endsAt: Option.none(),
                };
          const given_ = yield* Effect.result(
            Context.get(hub.context, GiveQuotaLogin).execute(pool.id, facts),
          );
          if (given_._tag === "Success") {
            done.push({
              _tag: "Give",
              pool: pool.id,
              at,
              endsAt,
              given,
              access: accessToken,
              refresh: refreshToken,
            });
          }
          break;
        }
        case "Forget": {
          const pool = poolOf(step.pool);
          const forgot = yield* Effect.result(
            Context.get(hub.context, ForgetQuotaLogin).execute(pool.id),
          );
          if (forgot._tag === "Success") {
            done.push({ _tag: "Forget", pool: pool.id, at });
          }
          break;
        }
        case "Read": {
          const pool = poolOf(step.pool);
          const row = yield* Context.get(hub.context, QuotaLogins)
            .find(pool.id)
            .pipe(Effect.orElseSucceed(() => Option.none()));
          const reader = Readers.readerOf(pool, row);
          if (Option.isNone(reader)) break;
          reads++;
          yield* Effect.forkIn(
            Context.get(hub.context, ReadQuota)
              .execute(pool, reader.value)
              .pipe(Effect.ignore, Effect.provideService(ReadId, reads)),
            hub.scope,
          );
          break;
        }
        case "Keep":
          yield* Effect.forkIn(
            Context.get(hub.context, KeepQuotaLoginsAlive).execute,
            hub.scope,
          );
          break;
        case "Move": {
          done.push({ _tag: "Move", to: at + step.ms });
          yield* TestClock.setTime(at + step.ms);
          break;
        }
        case "MoveTo": {
          const target = Math.max(at, (yield* targetOf(step, at)) + step.nudge);
          done.push({ _tag: "Move", to: target });
          yield* TestClock.setTime(target);
          break;
        }
        case "Restart":
          yield* Scope.close(hub.scope, Exit.void);
          hub = yield* begin;
          started = at;
          break;
        case "WritesFail":
          rows.writesFail = step.fail;
          break;
      }
      yield* settle;
    }
    const end = (yield* now()) + 2 * hour;
    done.push({ _tag: "Move", to: end });
    yield* TestClock.setTime(end);
    yield* settle;
    rows.writesFail = false;
    return {
      issued,
      tokens: scene.tokens,
      tokenCalls,
      usageCalls,
      done,
      mostInFlight,
      kept,
      now,
      seqNow: () => seq,
      readWith: (name: PoolName) =>
        Effect.gen(function* () {
          const pool = poolOf(name);
          const row = yield* Context.get(hub.context, QuotaLogins)
            .find(pool.id)
            .pipe(Effect.orElseSucceed(() => Option.none()));
          const reader = Readers.readerOf(pool, row);
          if (Option.isNone(reader)) return;
          reads++;
          yield* Effect.forkIn(
            Context.get(hub.context, ReadQuota)
              .execute(pool, reader.value)
              .pipe(Effect.ignore, Effect.provideService(ReadId, reads)),
            hub.scope,
          );
        }),
      restart: Effect.gen(function* () {
        yield* Scope.close(hub.scope, Exit.void);
        hub = yield* begin;
        started = yield* now();
      }),
      close: Effect.suspend(() => Scope.close(hub.scope, Exit.void)),
    };
  }).pipe(Effect.provide(Logger.layer([])));

type Saw = Effect.Success<ReturnType<typeof played>>;

const memory: Flavour = {
  reads: true,
  restarts: false,
  writeFailures: true,
  instant: false,
};
const restarting: Flavour = {
  reads: true,
  restarts: true,
  writeFailures: false,
  instant: false,
};

const runs = { arbitrary: { runs: 300 } };
const fewer = { arbitrary: { runs: 60 } };

const g3Prefix: Scene = {
  steps: [
    { _tag: "Give", pool: "claude", lifeMs: -minute },
    { _tag: "Read", pool: "claude" },
    { _tag: "Read", pool: "claude" },
    { _tag: "Move", ms: 4 * second },
    { _tag: "Move", ms: hour },
    { _tag: "Read", pool: "claude" },
  ],
  tokens: [
    { _tag: "Good", ms: 4 * second, rotates: true, lifeMs: hour },
    { _tag: "Good", ms: 0, rotates: true, lifeMs: hour },
  ],
  usage: [],
};

/** G3 over what a scene saw: no two refreshes of one login at once, and each sends the refresh token the last good one gave. */
const holdsG3 = (saw: Saw) => {
  expect(saw.mostInFlight).toBeLessThanOrEqual(1);
  const latest = new Map<number, string>();
  for (const [token, { given }] of saw.issued) {
    if (token.startsWith("refresh-") && !latest.has(given)) {
      latest.set(given, token);
    }
  }
  for (const call of saw.tokenCalls) {
    expect(call.sent).toBe(latest.get(call.given));
    const outcome = call.end?.outcome;
    if (outcome?._tag === "Good" && outcome.rotates) {
      const next = [...saw.issued].find(
        ([token, issued]) =>
          token.startsWith("refresh-") &&
          issued.given === call.given &&
          issued.seq === call.end?.seq,
      );
      if (next !== undefined) latest.set(call.given, next[0]);
    }
  }
};

const either = [memory, restarting] as const;

/** Plays a scene over a store and checks it with `holds`. */
const holding =
  (store: Store, holds: (saw: Saw) => Effect.Effect<void> | void) =>
  ({ scene }: { readonly scene: Scene }) =>
    Effect.gen(function* () {
      const saw = yield* played(scene, store);
      const checked = holds(saw);
      if (checked !== undefined) yield* checked;
      yield* saw.close;
    });

it.effect.prop(
  "G3: for any overlapping reads and keep-alive checks, no two refreshes of one quota login are in flight at once, and each sends the refresh token the previous good refresh returned, or the one given",
  { scene: scenes(either, g3Prefix) },
  holding("memory", holdsG3),
  runs,
);

const g4Prefix: Scene = {
  steps: [
    { _tag: "Give", pool: "claude", lifeMs: -minute },
    { _tag: "Read", pool: "claude" },
    { _tag: "Read", pool: "claude" },
    { _tag: "Keep" },
    { _tag: "Restart" },
    { _tag: "Read", pool: "claude" },
    { _tag: "Move", ms: hour },
  ],
  tokens: [{ _tag: "Refused", ms: 0 }],
  usage: [],
};

/** G4 over what a scene saw: after a login's refresh is refused, no refresh and no usage call is made with it. */
const holdsG4 = (saw: Saw) => {
  for (const refused of saw.tokenCalls) {
    if (refused.end?.outcome._tag !== "Refused") continue;
    const after = refused.end.seq;
    expect(
      saw.tokenCalls.filter(
        (call) => call.given === refused.given && call.startSeq > after,
      ),
    ).toEqual([]);
    expect(
      saw.usageCalls.filter(
        (call) =>
          saw.issued.get(call.access)?.given === refused.given &&
          call.startSeq > after,
      ),
    ).toEqual([]);
  }
};

/**
 * Scenes the G4 property found: logins given to one pool in one millisecond
 * while the store fails its writes and refreshes of the older ones run.
 */
const g4OneMillisecond: Scene = {
  steps: [
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Read", pool: "claude" },
    { _tag: "Read", pool: "claude" },
    { _tag: "Keep" },
    { _tag: "Restart" },
    { _tag: "Read", pool: "claude" },
    { _tag: "Move", ms: 3600000 },
    { _tag: "Forget", pool: "claude" },
    { _tag: "Forget", pool: "claude" },
    { _tag: "Give", pool: "codex", lifeMs: -60000 },
    { _tag: "Read", pool: "codex" },
    { _tag: "Give", pool: "codex", lifeMs: -60000 },
    { _tag: "Give", pool: "codex", lifeMs: -60000 },
    { _tag: "Read", pool: "codex" },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "WritesFail", fail: true },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Move", ms: 1 },
    { _tag: "Read", pool: "claude" },
  ],
  tokens: [
    { _tag: "Refused", ms: 0 },
    { _tag: "Good", ms: 12000, rotates: true, lifeMs: 300000 },
    { _tag: "Refused", ms: 1 },
    { _tag: "Good", ms: 4000, rotates: true, lifeMs: 3600000 },
    { _tag: "Good", ms: 0, rotates: false, lifeMs: 3600000 },
    { _tag: "Good", ms: 1, rotates: false, lifeMs: 120000 },
    { _tag: "Failed", ms: 1 },
    { _tag: "Good", ms: 0, rotates: true, lifeMs: 300000 },
    { _tag: "Good", ms: 1, rotates: false, lifeMs: 3600000 },
    { _tag: "Failed", ms: 0 },
    { _tag: "Failed", ms: 12000 },
  ],
  usage: [
    { _tag: "Unauthorized", ms: 0 },
    { _tag: "Good", ms: 0 },
    { _tag: "Good", ms: 1 },
    { _tag: "Good", ms: 1 },
    { _tag: "Failed", ms: 12000 },
    { _tag: "Unauthorized", ms: 12000 },
    { _tag: "Good", ms: 4000 },
    { _tag: "Failed", ms: 0 },
    { _tag: "Good", ms: 0 },
    { _tag: "Unauthorized", ms: 12000 },
  ],
};
const g4OneMillisecondAgain: Scene = {
  steps: [
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Read", pool: "claude" },
    { _tag: "Read", pool: "claude" },
    { _tag: "Keep" },
    { _tag: "Restart" },
    { _tag: "Read", pool: "claude" },
    { _tag: "Move", ms: 3600000 },
    { _tag: "Give", pool: "codex", lifeMs: 1800000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "MoveTo", to: "hour", nudge: 0 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "MoveTo", to: "hour", nudge: 0 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "MoveTo", to: "hour", nudge: -1 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Read", pool: "codex" },
    { _tag: "Read", pool: "claude" },
    { _tag: "Read", pool: "claude" },
    { _tag: "Give", pool: "claude", lifeMs: 1800000 },
    { _tag: "Give", pool: "claude", lifeMs: 300000 },
    { _tag: "WritesFail", fail: true },
  ],
  tokens: [
    { _tag: "Refused", ms: 0 },
    { _tag: "Good", ms: 0, rotates: true, lifeMs: 300001 },
    { _tag: "Good", ms: 0, rotates: false, lifeMs: 300000 },
    { _tag: "Failed", ms: 0 },
    { _tag: "Good", ms: 4000, rotates: true, lifeMs: 300001 },
    { _tag: "Good", ms: 1, rotates: true, lifeMs: 300001 },
    { _tag: "Good", ms: 1, rotates: false, lifeMs: 120000 },
    { _tag: "Refused", ms: 1 },
    { _tag: "Good", ms: 1, rotates: false, lifeMs: 28800000 },
    { _tag: "Good", ms: 0, rotates: true, lifeMs: 3600000 },
    { _tag: "Failed", ms: 12000 },
  ],
  usage: [
    { _tag: "Good", ms: 1 },
    { _tag: "Unauthorized", ms: 4000 },
    { _tag: "Good", ms: 0 },
    { _tag: "Good", ms: 0 },
    { _tag: "Good", ms: 12000 },
    { _tag: "Good", ms: 12000 },
    { _tag: "Good", ms: 1 },
    { _tag: "Unauthorized", ms: 1 },
    { _tag: "Unauthorized", ms: 12000 },
    { _tag: "Good", ms: 0 },
  ],
};
const g4OneMillisecondHeld: Scene = {
  steps: [
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Read", pool: "claude" },
    { _tag: "Read", pool: "claude" },
    { _tag: "Keep" },
    { _tag: "Restart" },
    { _tag: "Read", pool: "claude" },
    { _tag: "Move", ms: 3600000 },
    { _tag: "MoveTo", to: "hour", nudge: -1 },
    { _tag: "Give", pool: "claude", lifeMs: 300001 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Keep" },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Read", pool: "claude" },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "WritesFail", fail: true },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: -60000 },
    { _tag: "Give", pool: "claude", lifeMs: 299999 },
  ],
  tokens: [
    { _tag: "Refused", ms: 0 },
    { _tag: "Refused", ms: 0 },
    { _tag: "Good", ms: 4000, rotates: true, lifeMs: 28800000 },
    { _tag: "Refused", ms: 1 },
    { _tag: "Good", ms: 1, rotates: true, lifeMs: 300000 },
    { _tag: "Refused", ms: 1 },
    { _tag: "Failed", ms: 0 },
    { _tag: "Good", ms: 0, rotates: true, lifeMs: 300001 },
    { _tag: "Good", ms: 4000, rotates: false, lifeMs: 28800000 },
    { _tag: "Good", ms: 0, rotates: true, lifeMs: 120000 },
    { _tag: "Refused", ms: 0 },
  ],
  usage: [
    { _tag: "Good", ms: 0 },
    { _tag: "Unauthorized", ms: 4000 },
    { _tag: "Good", ms: 0 },
    { _tag: "Failed", ms: 0 },
    { _tag: "Failed", ms: 0 },
    { _tag: "Failed", ms: 0 },
    { _tag: "Failed", ms: 12000 },
    { _tag: "Unauthorized", ms: 12000 },
    { _tag: "Good", ms: 0 },
    { _tag: "Unauthorized", ms: 4000 },
  ],
};

const g5Prefix: Scene = {
  steps: [
    { _tag: "Give", pool: "claude", lifeMs: fresh },
    { _tag: "Read", pool: "claude" },
    { _tag: "Give", pool: "codex", lifeMs: -minute },
    { _tag: "Read", pool: "codex" },
  ],
  tokens: [
    { _tag: "Good", ms: 0, rotates: true, lifeMs: hour },
    { _tag: "Good", ms: 0, rotates: true, lifeMs: 2 * minute },
  ],
  usage: [],
};

const holdsG5 = (saw: Saw) => {
  for (const call of saw.usageCalls) {
    const issued = saw.issued.get(call.access);
    expect(issued).toBeDefined();
    expect(issued?.endsAt ?? 0).toBeGreaterThan(call.at + fresh);
  }
};

const g6Prefix: Scene = {
  steps: [
    { _tag: "Give", pool: "claude", lifeMs: hour },
    { _tag: "Read", pool: "claude" },
    { _tag: "Read", pool: "claude" },
  ],
  tokens: [{ _tag: "Good", ms: 0, rotates: true, lifeMs: hour }],
  usage: [
    { _tag: "Unauthorized", ms: 0 },
    { _tag: "Unauthorized", ms: 0 },
    { _tag: "Failed", ms: 0 },
  ],
};

/** Whether a token, by the login it is of and when it was issued, came after another: the pool's login refreshed, or given again. */
const isNewer = (
  token: ReadonlyArray<number>,
  than: ReadonlyArray<number>,
): boolean => {
  const [given = -1, seq = -1] = token;
  const [otherGiven = Infinity, otherSeq = Infinity] = than;
  return given > otherGiven || (given === otherGiven && seq > otherSeq);
};

const holdsG6 = (saw: Saw) => {
  const byRead = new Map<number, Array<UsageCall>>();
  for (const call of saw.usageCalls) {
    byRead.set(call.read, [...(byRead.get(call.read) ?? []), call]);
  }
  for (const calls of byRead.values()) {
    expect(calls.length).toBeLessThanOrEqual(2);
    const [first, retry] = calls;
    if (first === undefined || retry === undefined) continue;
    expect(first.end?.outcome._tag).toBe("Unauthorized");
    expect(retry.startSeq).toBeGreaterThan(first.end?.seq ?? Infinity);
    const [sent, again] = [first, retry].map((call) => {
      const issued = saw.issued.get(call.access);
      return issued === undefined ? [] : [issued.given, issued.seq];
    });
    expect(
      again !== undefined && sent !== undefined && isNewer(again, sent),
    ).toBe(true);
  }
};

it.effect.prop(
  "G4: once a token endpoint refuses a quota login's refresh, no refresh and no usage call is made with that login, across restarts, until a new one is given for its pool",
  { scene: scenes(either, g4Prefix) },
  holding("memory", holdsG4),
  runs,
);

it.effect(
  "G4: a quota login refused while another given to its pool in the same millisecond is refreshed is not refreshed again, though the store fails to write its expiry",
  () =>
    holding(
      "memory",
      holdsG4,
    )({
      scene: {
        steps: [
          { _tag: "Give", pool: "claude", lifeMs: -minute },
          { _tag: "Read", pool: "claude" },
          { _tag: "Give", pool: "claude", lifeMs: -minute },
          { _tag: "WritesFail", fail: true },
          { _tag: "Keep" },
          { _tag: "MoveTo", to: "end", nudge: 0 },
          { _tag: "Keep" },
        ],
        tokens: [
          { _tag: "Good", ms: 4 * second, rotates: true, lifeMs: hour },
          { _tag: "Refused", ms: 0 },
        ],
        usage: [],
      },
    }),
);

for (const [scene, which] of [
  [g4OneMillisecond, "first"],
  [g4OneMillisecondAgain, "second"],
  [g4OneMillisecondHeld, "third"],
] as const) {
  it.effect(
    `G4: a quota login refused while others given to its pool in the same millisecond are refreshed and the store fails its writes is not used again, in the ${which} scene the property found`,
    () => holding("memory", holdsG4)({ scene }),
  );
}

it.effect(
  "G4: a refused quota login whose expiry the store could not write is refreshed once more after a restart, and is then expired for good",
  () =>
    Effect.gen(function* () {
      const saw = yield* played(
        {
          steps: [
            { _tag: "Give", pool: "claude", lifeMs: -minute },
            { _tag: "WritesFail", fail: true },
            { _tag: "Read", pool: "claude" },
            { _tag: "WritesFail", fail: false },
            { _tag: "Restart" },
            { _tag: "Read", pool: "claude" },
          ],
          tokens: [
            { _tag: "Refused", ms: 0 },
            { _tag: "Refused", ms: 0 },
          ],
          usage: [],
        },
        "memory",
      );
      expect({
        refreshes: saw.tokenCalls.map((call) => [
          call.sent,
          call.end?.outcome._tag,
        ]),
        usage: saw.usageCalls,
        expired: (yield* saw.kept()).map((login) =>
          Option.isSome(login.expiredAt),
        ),
      }).toEqual({
        refreshes: [
          ["refresh-1", "Refused"],
          ["refresh-1", "Refused"],
        ],
        usage: [],
        expired: [true],
      });
      yield* saw.close;
    }),
);

/** The usage calls a scene made with the first login given. */
const usedFirstLogin = (saw: Saw) =>
  saw.usageCalls.filter((call) => saw.issued.get(call.access)?.given === 1);

it.effect(
  "a quota login forgotten while it is refreshed is not sent to the usage endpoint afterwards",
  () =>
    Effect.gen(function* () {
      const saw = yield* played(
        {
          steps: [
            { _tag: "Give", pool: "claude", lifeMs: -minute },
            { _tag: "Read", pool: "claude" },
            { _tag: "Forget", pool: "claude" },
            { _tag: "MoveTo", to: "end", nudge: 0 },
          ],
          tokens: [
            { _tag: "Good", ms: 4 * second, rotates: true, lifeMs: hour },
          ],
          usage: [],
        },
        "memory",
      );
      expect({
        refreshes: saw.tokenCalls.filter((call) => call.given === 1).length,
        usage: usedFirstLogin(saw),
      }).toEqual({ refreshes: 1, usage: [] });
      yield* saw.close;
    }),
);

it.effect(
  "a quota login replaced while it is refreshed is not sent to the usage endpoint afterwards",
  () =>
    Effect.gen(function* () {
      const saw = yield* played(
        {
          steps: [
            { _tag: "Give", pool: "claude", lifeMs: -minute },
            { _tag: "Read", pool: "claude" },
            { _tag: "Give", pool: "claude", lifeMs: hour },
            { _tag: "MoveTo", to: "end", nudge: 0 },
          ],
          tokens: [
            { _tag: "Good", ms: 4 * second, rotates: true, lifeMs: hour },
          ],
          usage: [],
        },
        "memory",
      );
      expect({
        refreshes: saw.tokenCalls.filter((call) => call.given === 1).length,
        usage: usedFirstLogin(saw),
      }).toEqual({ refreshes: 1, usage: [] });
      yield* saw.close;
    }),
);

it.effect.prop(
  "G4: over a SQLite store, restarted, a refused quota login is neither refreshed nor used until a new one is given",
  { scene: scenes([restarting, restarting], g4Prefix) },
  holding("sqlite", holdsG4),
  fewer,
);

it.effect.prop(
  "G5: no usage call sends an access token that ends within 5 minutes of the call",
  { scene: scenes(either, g5Prefix) },
  holding("memory", holdsG5),
  runs,
);

it.effect.prop(
  "G6: a read makes at most two usage calls, and a second only after the first was answered 401 and the login was then refreshed",
  { scene: scenes(either, g6Prefix) },
  holding("memory", holdsG6),
  runs,
);

const g7Prefix: Scene = {
  steps: [
    { _tag: "Give", pool: "claude", lifeMs: -minute },
    { _tag: "Read", pool: "claude" },
    { _tag: "Give", pool: "codex", lifeMs: hour },
  ],
  tokens: [{ _tag: "Good", ms: 0, rotates: true, lifeMs: hour }],
  usage: [],
};

/** The tokens each pool's row should hold after what a scene saw: the latest good refresh's of the login given last, else the given ones. */
const expectedRows = (saw: Saw) => {
  const rows = new Map<
    PoolId,
    { access: string; refresh: string; expired: boolean }
  >();
  for (const done of saw.done) {
    if (done._tag === "Forget") rows.delete(done.pool);
    if (done._tag !== "Give") continue;
    let { access, refresh } = done;
    let expired = false;
    for (const call of saw.tokenCalls) {
      if (call.given !== done.given || call.end === undefined) continue;
      const { outcome, seq } = call.end;
      if (outcome._tag === "Refused") expired = true;
      if (outcome._tag !== "Good") continue;
      for (const [token, issued] of saw.issued) {
        if (issued.given !== done.given || issued.seq !== seq) continue;
        if (token.startsWith("access-")) access = token;
        if (token.startsWith("refresh-")) refresh = token;
      }
    }
    rows.set(done.pool, { access, refresh, expired });
  }
  return rows;
};

const rowsHeld = (logins: ReadonlyArray<QuotaLogin.QuotaLogin>) =>
  new Map(
    logins.map((login) => [
      login.pool,
      {
        access: Redacted.value(login.accessToken),
        refresh: Redacted.value(login.refreshToken),
        expired: Option.isSome(login.expiredAt),
      },
    ]),
  );

const holdsG7 = (saw: Saw) =>
  Effect.gen(function* () {
    const held = rowsHeld(yield* saw.kept());
    expect(held).toEqual(expectedRows(saw));
    const since = saw.seqNow();
    yield* saw.restart;
    for (const name of ["claude", "codex"] as const) {
      yield* saw.readWith(name);
    }
    const now = yield* saw.now();
    yield* TestClock.adjust(Duration.minutes(1));
    yield* settle;
    for (const [pool, row] of held) {
      if (row.expired) continue;
      const due = (saw.issued.get(row.access)?.endsAt ?? 0) <= now + fresh;
      const first = due
        ? saw.tokenCalls.find(
            (call) => call.pool === pool && call.startSeq >= since,
          )?.sent
        : saw.usageCalls.find(
            (call) => call.pool === pool && call.startSeq >= since,
          )?.access;
      expect(first).toBe(due ? row.refresh : row.access);
    }
  });

it.effect.prop(
  "G7: after any sequence of gives and refreshes whose writes succeed, the hub store holds the tokens of the latest good refresh, or the given ones when none followed, and a hub started on it reads with them",
  { scene: scenes([restarting, restarting], g7Prefix) },
  holding("memory", holdsG7),
  runs,
);

it.effect.prop(
  "G7: over a SQLite store, restarted, the store holds the tokens of the latest good refresh, or the given ones, and a hub started on it reads with them",
  { scene: scenes([restarting, restarting], g7Prefix) },
  holding("sqlite", holdsG7),
  fewer,
);

/** The keep-alive of the quota logins spec, worked out again over what a scene did: the refreshes it makes, each with its pool and time. */
const keepAliveOf = (
  done: ReadonlyArray<Done>,
  tokens: ReadonlyArray<TokenOutcome>,
) => {
  const logins = new Map<PoolId, { endsAt: number; expired: boolean }>();
  const refreshes: Array<{ pool: PoolId; at: number }> = [];
  let started = start;
  let now = start;
  const check = (at: number) => {
    for (const pool of [...logins.keys()].sort()) {
      const login = logins.get(pool);
      if (login === undefined || login.expired || login.endsAt > at + fresh) {
        continue;
      }
      const outcome: TokenOutcome = tokens[refreshes.length] ?? {
        _tag: "Good",
        ms: 0,
        rotates: true,
        lifeMs: hour,
      };
      refreshes.push({ pool, at });
      if (outcome._tag === "Good") login.endsAt = at + outcome.lifeMs;
      if (outcome._tag === "Refused") login.expired = true;
    }
  };
  for (const step of done) {
    switch (step._tag) {
      case "Start":
        started = step.at;
        check(step.at);
        break;
      case "Give":
        logins.set(step.pool, { endsAt: step.endsAt, expired: false });
        break;
      case "Forget":
        logins.delete(step.pool);
        break;
      case "Move":
        for (
          let next = started + (Math.floor((now - started) / hour) + 1) * hour;
          next <= step.to;
          next += hour
        ) {
          check(next);
        }
        now = step.to;
    }
  }
  return refreshes;
};

const instant: Flavour = {
  reads: false,
  restarts: true,
  writeFailures: false,
  instant: true,
};

const g8Prefix: Scene = {
  steps: [
    { _tag: "Give", pool: "claude", lifeMs: fresh },
    { _tag: "Give", pool: "codex", lifeMs: hour },
    { _tag: "Restart" },
    { _tag: "MoveTo", to: "hour", nudge: 0 },
  ],
  tokens: [],
  usage: [],
};

it.effect.prop(
  "G8: at the hub's start and at every hour after it, every kept quota login that is not expired and whose access token ends within 5 minutes of that check is refreshed",
  { scene: scenes([instant, instant], g8Prefix) },
  holding("memory", (saw) => {
    expect(
      saw.tokenCalls.map((call) => ({ pool: call.pool, at: call.at })),
    ).toEqual(keepAliveOf(saw.done, saw.tokens));
  }),
  runs,
);
