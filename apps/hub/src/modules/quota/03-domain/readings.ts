import {
  Context,
  DateTime,
  Duration,
  Effect,
  Fiber,
  HashMap,
  Layer,
  Option,
  Ref,
  Result,
  Schema,
} from "effect";
import type { PoolId } from "#shared/03-domain/ids.ts";
import type { QuotaReading } from "./sources.ts";

/** The longest a pool waits to be read again after failed reads, whatever their number. */
export const longestBackoff = Duration.minutes(15);

/** Why a read of a pool's usage endpoint gave no quota reading. */
export class ReadFailure extends Schema.TaggedError<
  ReadFailure,
  { readonly brand: unique symbol }
>()("ReadFailure", {
  kind: Schema.Literals([
    "unreachable",
    "refused",
    "rate-limited",
    "failed",
    "unreadable",
  ]),
  /** The provider's HTTP status, when it answered. */
  status: Schema.Option(Schema.Int),
  /** One sentence naming the provider and what happened, never a body, a header, a token or a key. */
  detail: Schema.String,
  /** The instant a 429's `retry-after` names, when it gives one. */
  retryAt: Schema.Option(Schema.DateTimeUtc),
}) {}

/** A read that found the pool's quota login expired: the pool's state is forgotten and it is no longer read. */
export class QuotaLoginExpired extends Schema.TaggedError<
  QuotaLoginExpired,
  { readonly brand: unique symbol }
>()("QuotaLoginExpired", {}) {}

/** A good quota reading and when its read ended. */
export interface Taken {
  readonly reading: QuotaReading;
  readonly at: DateTime.Utc;
}

/** A failed read and when it ended. */
export interface Failed {
  readonly failure: ReadFailure;
  readonly at: DateTime.Utc;
}

/** What the hub keeps of a pool it reads. */
export interface Kept {
  /** Its last good quota reading; none since the hub started or its state was forgotten. */
  readonly last: Option.Option<Taken>;
  /** The latest failure since that reading. */
  readonly failure: Option.Option<Failed>;
  /** How many reads have failed in a row. */
  readonly failures: number;
  /** When the next read may start; none when it has never been read. */
  readonly nextAt: Option.Option<DateTime.Utc>;
}

/** How long after the `failures`-th failed read in a row the next read waits: the period, doubled after each further one, at most `longestBackoff`. */
const backoff = (
  period: Duration.Duration,
  failures: number,
): Duration.Duration =>
  Duration.min(Duration.times(period, 2 ** (failures - 1)), longestBackoff);

interface Running {
  readonly token: object;
  /** Starts the read once, in the layer's scope, and gives its fiber. */
  readonly start: Effect.Effect<Fiber.Fiber<void>>;
  /** Whether the pool's state was forgotten while it ran, so that its outcome is not kept. */
  readonly forgotten: boolean;
}

interface Entry extends Kept {
  readonly running: Option.Option<Running>;
}

const empty: Entry = {
  last: Option.none(),
  failure: Option.none(),
  failures: 0,
  nextAt: Option.none(),
  running: Option.none(),
};

const keptOf = ({ running: _, ...kept }: Entry): Kept => kept;

const good = (
  reading: QuotaReading,
  period: Duration.Duration,
  at: DateTime.Utc,
): Entry => ({
  last: Option.some({ reading, at }),
  failure: Option.none(),
  failures: 0,
  nextAt: Option.some(DateTime.addDuration(at, period)),
  running: Option.none(),
});

const failed = (
  entry: Entry,
  failure: ReadFailure,
  period: Duration.Duration,
  at: DateTime.Utc,
): Entry => {
  const failures = entry.failures + 1;
  const waited = DateTime.addDuration(at, backoff(period, failures));
  return {
    last: entry.last,
    failure: Option.some({ failure, at }),
    failures,
    nextAt: Option.some(
      Option.match(failure.retryAt, {
        onNone: () => waited,
        onSome: (retryAt) => DateTime.max(waited, retryAt),
      }),
    ),
    running: Option.none(),
  };
};

/** The quota readings of the pools the hub reads, kept in memory since it started, read on demand. */
export class Readings extends Context.Service<
  Readings,
  {
    /**
     * Answers what is kept of a pool, after reading it with `read` when no
     * read of it is running and it has never been read or its next read's
     * time has come; a read already running is waited for instead of
     * starting another (U1 to U4). A read runs to its end in the layer's
     * scope, and its outcome is kept, even when nobody waits for it any more.
     */
    readonly ask: (
      pool: PoolId,
      period: Duration.Duration,
      read: Effect.Effect<QuotaReading, ReadFailure | QuotaLoginExpired>,
    ) => Effect.Effect<Kept>;
    /** Forgets a pool's reading, failures and next read's time; a read of it still running ends without its outcome being kept. */
    readonly forget: (pool: PoolId) => Effect.Effect<void>;
  }
>()("@cota/hub/quota/Readings") {}

export const layer: Layer.Layer<Readings> = Layer.effect(
  Readings,
  Effect.gen(function* () {
    const scope = yield* Effect.scope;
    const entries = yield* Ref.make(HashMap.empty<PoolId, Entry>());

    const entryOf = (map: HashMap.HashMap<PoolId, Entry>, pool: PoolId) =>
      Option.getOrElse(HashMap.get(map, pool), () => empty);

    /** Ends the read `token` names, if it is still the pool's, keeping its outcome unless the pool was forgotten meanwhile. */
    const settle = (
      pool: PoolId,
      token: object,
      outcome: (entry: Entry) => Entry,
    ) =>
      Ref.update(entries, (map) => {
        const entry = entryOf(map, pool);
        if (
          Option.isNone(entry.running) ||
          entry.running.value.token !== token
        ) {
          return map;
        }
        return HashMap.set(
          map,
          pool,
          entry.running.value.forgotten
            ? { ...entry, running: Option.none() }
            : outcome(entry),
        );
      });

    const run = (
      pool: PoolId,
      period: Duration.Duration,
      read: Effect.Effect<QuotaReading, ReadFailure | QuotaLoginExpired>,
      token: object,
    ) =>
      Effect.gen(function* () {
        const outcome = yield* Effect.result(read);
        const at = yield* DateTime.now;
        yield* settle(pool, token, (entry) => {
          if (Result.isSuccess(outcome)) {
            return good(outcome.success, period, at);
          }
          if (outcome.failure._tag === "QuotaLoginExpired") return empty;
          return failed(entry, outcome.failure, period, at);
        });
      }).pipe(
        Effect.ensuring(
          settle(pool, token, (entry) => ({
            ...entry,
            running: Option.none(),
          })),
        ),
      );

    return Readings.of({
      ask: Effect.fn("Readings.ask")(function* (pool, period, read) {
        const now = yield* DateTime.now;
        const token = {};
        const start = yield* Effect.cached(
          Effect.forkIn(run(pool, period, read, token), scope),
        );
        const chosen = Ref.modify(entries, (map) => {
          const entry = entryOf(map, pool);
          if (Option.isSome(entry.running)) {
            return [Effect.asSome(entry.running.value.start), map] as const;
          }
          const due = Option.match(entry.nextAt, {
            onNone: () => true,
            onSome: (nextAt) => DateTime.isGreaterThanOrEqualTo(now, nextAt),
          });
          if (!due) return [Effect.succeedNone, map] as const;
          return [
            Effect.asSome(start),
            HashMap.set(map, pool, {
              ...entry,
              running: Option.some({ token, start, forgotten: false }),
            }),
          ] as const;
        });
        const running = yield* Effect.uninterruptible(Effect.flatten(chosen));
        if (Option.isSome(running)) yield* Fiber.join(running.value);
        return keptOf(entryOf(yield* Ref.get(entries), pool));
      }),
      forget: (pool) =>
        Ref.update(entries, (map) =>
          HashMap.set(map, pool, {
            ...empty,
            running: Option.map(entryOf(map, pool).running, (running) => ({
              ...running,
              forgotten: true,
            })),
          }),
        ),
    });
  }),
);
