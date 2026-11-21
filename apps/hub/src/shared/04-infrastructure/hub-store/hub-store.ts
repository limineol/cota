import { Database } from "bun:sqlite";
import {
  accessSync,
  closeSync,
  constants,
  existsSync,
  openSync,
  statSync,
} from "node:fs";
import { dirname } from "node:path";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { HubStoreUnavailable } from "#shared/03-domain/hub-store.ts";

/**
 * One change to the hub store's tables, named `<module>/<four digits>-<what>`.
 * A released step is never edited or removed; a change is a new step.
 */
export interface Step {
  readonly name: string;
  readonly sql: string;
}

export interface Options {
  /** The store's file; its directory must exist. */
  readonly path: string;
  /** Every step the hub lists, module by module, then step by step. */
  readonly steps: ReadonlyArray<Step>;
}

/** Why the hub does not start with its store; it prints this and exits 1. */
export class HubStoreRefused extends Schema.TaggedError<
  HubStoreRefused,
  { readonly brand: unique symbol }
>()("HubStoreRefused", { path: Schema.String, problem: Schema.String }) {
  override get message(): string {
    return `The hub store ${this.path} ${this.problem}.`;
  }
}

/** The hub store's one connection, which a module's SQLite adapter runs its SQL on. */
export class HubStore extends Context.Service<
  HubStore,
  {
    /** Runs `run` on the connection; anything it throws fails the call with `HubStoreUnavailable`. */
    readonly use: <A>(
      run: (database: Database) => A,
    ) => Effect.Effect<A, HubStoreUnavailable>;
  }
>()("@cota/hub/HubStore") {}

const codeOf = (cause: unknown): string | undefined =>
  cause instanceof Error && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : undefined;

const detailOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const open = Effect.fn("HubStore.open")(function* (
  path: string,
  create: boolean,
) {
  const refused = (problem: string) => new HubStoreRefused({ path, problem });
  if (!create && !existsSync(path)) return yield* refused("does not exist");
  if (existsSync(path)) {
    const mode = statSync(path).mode & 0o777;
    if ((mode & 0o077) !== 0) {
      yield* Effect.logWarning(
        "the hub store can be read by others than the hub's user; it holds quota logins, so make it mode 0600",
      ).pipe(Effect.annotateLogs({ path, mode: `0${mode.toString(8)}` }));
    }
  } else {
    yield* Effect.try({
      try: () => closeSync(openSync(path, "wx", 0o600)),
      catch: (cause) =>
        refused(
          codeOf(cause) === "ENOENT"
            ? `cannot be created: its directory ${dirname(path)} does not exist`
            : `cannot be created: ${detailOf(cause)}`,
        ),
    });
  }
  // SQLite opens a file it cannot write as read-only without saying so.
  yield* Effect.try({
    try: () => accessSync(path, constants.R_OK | constants.W_OK),
    catch: () => refused("cannot be read and written by the hub"),
  });
  return yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        const database = new Database(path, {
          readwrite: true,
          create: false,
          strict: true,
        });
        try {
          database.run("PRAGMA journal_mode = WAL");
          database.run("PRAGMA foreign_keys = ON");
          database.run("PRAGMA busy_timeout = 5000");
          database.run("PRAGMA secure_delete = ON");
        } catch (cause) {
          database.close();
          throw cause;
        }
        return database;
      },
      catch: (cause) =>
        refused(
          codeOf(cause) === "SQLITE_NOTADB"
            ? "is not a SQLite database"
            : `cannot be opened: ${detailOf(cause)}`,
        ),
    }),
    (database) => Effect.sync(() => database.close()),
  );
});

const migrate = Effect.fn("HubStore.migrate")(function* (
  database: Database,
  { path, steps }: Options,
) {
  const refused = (problem: string) => new HubStoreRefused({ path, problem });
  const applied = yield* Effect.try({
    try: () => {
      database.run(
        "CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
      );
      return database
        .query("SELECT name FROM migrations")
        .values()
        .map(([name]) => String(name));
    },
    catch: (cause) => refused(`cannot be migrated: ${detailOf(cause)}`),
  });
  const listed = new Set(steps.map(({ name }) => name));
  const unknown = applied.filter((name) => !listed.has(name));
  if (unknown.length > 0) {
    return yield* refused(
      `was written by a newer hub: it holds ${unknown.join(", ")}, which this hub does not know`,
    );
  }
  for (const step of steps) {
    if (applied.includes(step.name)) continue;
    const appliedAt = DateTime.formatIso(yield* DateTime.now);
    yield* Effect.try({
      try: () =>
        database.transaction(() => {
          database.run(step.sql);
          database.run(
            "INSERT INTO migrations (name, applied_at) VALUES (?, ?)",
            [step.name, appliedAt],
          );
        })(),
      catch: (cause) =>
        refused(
          `cannot be migrated: the step ${step.name} failed: ${detailOf(cause)}`,
        ),
    });
  }
});

const appliedOf = (database: Database, path: string) =>
  Effect.try({
    try: () =>
      database
        .query("SELECT name FROM migrations")
        .values()
        .map(([name]) => String(name)),
    catch: (cause) =>
      new HubStoreRefused({
        path,
        problem: `has no migrations this hub can read: ${detailOf(cause)}`,
      }),
  });

const serviceOf = (database: Database) =>
  HubStore.of({
    use: (run) =>
      Effect.try({
        try: () => run(database),
        catch: (cause) => new HubStoreUnavailable({ detail: detailOf(cause) }),
      }),
  });

/**
 * The hub store at `path`, as it is: it refuses a store that is missing or
 * whose applied steps are not exactly the ones listed, and migrates nothing,
 * for a command run beside the hub that must not change its store's tables.
 */
export const migrated = (
  options: Options,
): Layer.Layer<HubStore, HubStoreRefused> =>
  Layer.effect(
    HubStore,
    Effect.gen(function* () {
      const database = yield* open(options.path, false);
      const applied = new Set(yield* appliedOf(database, options.path));
      const listed = new Set(options.steps.map(({ name }) => name));
      if (
        applied.size !== listed.size ||
        [...listed].some((name) => !applied.has(name))
      ) {
        return yield* new HubStoreRefused({
          path: options.path,
          problem:
            "is not at this hub's steps: start this hub once, so that it migrates its store, then run the command again",
        });
      }
      return serviceOf(database);
    }),
  );

/**
 * The hub store at `path`, created with mode 0600 when missing and migrated by
 * the listed steps; it refuses a store it cannot open or that a newer hub
 * wrote (M1 to M4), and warns of one others than its user can read.
 */
export const layer = (
  options: Options,
): Layer.Layer<HubStore, HubStoreRefused> =>
  Layer.effect(
    HubStore,
    Effect.gen(function* () {
      const database = yield* open(options.path, true);
      yield* migrate(database, options);
      return serviceOf(database);
    }),
  );
