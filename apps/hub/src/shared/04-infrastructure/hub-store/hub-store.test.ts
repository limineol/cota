import { Database } from "bun:sqlite";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Logger } from "effect";
import * as HubStore from "./hub-store.ts";

const scratch = mkdtempSync(join(tmpdir(), "cota-hub-store-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const refusalOf = (path: string, steps: ReadonlyArray<HubStore.Step> = []) =>
  Effect.scoped(Layer.build(HubStore.layer({ path, steps }))).pipe(
    Effect.flip,
    Effect.map((error) => error.message),
  );

const namesIn = (path: string, query: string): ReadonlyArray<string> => {
  const database = new Database(path, { readonly: true });
  try {
    return database
      .query(query)
      .values()
      .map(([name]) => String(name));
  } finally {
    database.close();
  }
};

describe("HubStore.layer", () => {
  it.effect(
    "opens the store in WAL mode, with foreign keys on, a busy timeout of 5 seconds and deleted rows overwritten",
    () =>
      Effect.gen(function* () {
        const store = yield* HubStore.HubStore;
        const pragmas = yield* store.use((database) =>
          ["journal_mode", "foreign_keys", "busy_timeout", "secure_delete"].map(
            (pragma) => database.query(`PRAGMA ${pragma}`).values()[0]?.[0],
          ),
        );
        expect(pragmas).toEqual(["wal", 1, 5000, 1]);
      }).pipe(
        Effect.provide(
          HubStore.layer({ path: join(scratch, "pragmas.sqlite"), steps: [] }),
        ),
      ),
  );

  it.effect(
    "refuses a store whose directory does not exist, and creates nothing",
    () =>
      Effect.gen(function* () {
        const path = join(scratch, "missing", "cota.sqlite");
        expect(yield* refusalOf(path)).toBe(
          `The hub store ${path} cannot be created: its directory ${join(scratch, "missing")} does not exist.`,
        );
        expect(existsSync(join(scratch, "missing"))).toBe(false);
      }),
  );

  it.effect(
    "refuses a file that is not a SQLite database, and leaves it as it was",
    () =>
      Effect.gen(function* () {
        const path = join(scratch, "notes.sqlite");
        const text = "these are the owner's notes, not a database\n".repeat(4);
        writeFileSync(path, text);
        expect(yield* refusalOf(path)).toBe(
          `The hub store ${path} is not a SQLite database.`,
        );
        expect(readFileSync(path, "utf8")).toBe(text);
      }),
  );

  it.effect(
    "warns, naming the file and its mode, when the store it opens can be read by others than its user, and opens it",
    () =>
      Effect.gen(function* () {
        const path = join(scratch, "shared.sqlite");
        const quiet = join(scratch, "private.sqlite");
        for (const [file, mode] of [
          [path, 0o640],
          [quiet, 0o600],
        ] as const) {
          yield* Effect.scoped(
            Layer.build(HubStore.layer({ path: file, steps: [] })),
          );
          chmodSync(file, mode);
        }
        const lines: Array<string> = [];
        const capture = Logger.map(Logger.formatJson, (line) => {
          lines.push(line);
        });
        for (const file of [path, quiet]) {
          yield* Effect.scoped(
            Layer.build(HubStore.layer({ path: file, steps: [] })),
          ).pipe(Effect.provide(Logger.layer([capture])));
        }
        expect(
          lines
            .map((line) => JSON.parse(line))
            .map(({ level, message, annotations }) => ({
              level,
              message,
              annotations,
            })),
        ).toEqual([
          {
            level: "WARN",
            message:
              "the hub store can be read by others than the hub's user; it holds quota logins, so make it mode 0600",
            annotations: { path, mode: "0640" },
          },
        ]);
      }),
  );

  it.effect("refuses a store the hub cannot write", () =>
    Effect.gen(function* () {
      const path = join(scratch, "read-only.sqlite");
      yield* Effect.scoped(Layer.build(HubStore.layer({ path, steps: [] })));
      chmodSync(path, 0o400);
      expect(yield* refusalOf(path)).toBe(
        `The hub store ${path} cannot be read and written by the hub.`,
      );
    }),
  );

  it.effect(
    "stops at a step that fails, naming it, and keeps the steps before it and nothing of it",
    () =>
      Effect.gen(function* () {
        const path = join(scratch, "failing-step.sqlite");
        const steps: ReadonlyArray<HubStore.Step> = [
          { name: "notes/0001-notes", sql: "CREATE TABLE notes (text TEXT)" },
          {
            name: "notes/0002-tags",
            sql: "CREATE TABLE tags (tag TEXT); CREATE TABLE notes (text TEXT)",
          },
          { name: "notes/0003-pins", sql: "CREATE TABLE pins (note TEXT)" },
        ];
        expect(yield* refusalOf(path, steps)).toBe(
          `The hub store ${path} cannot be migrated: the step notes/0002-tags failed: table notes already exists.`,
        );
        expect([
          namesIn(path, "SELECT name FROM migrations ORDER BY rowid"),
          namesIn(
            path,
            "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
          ),
        ]).toEqual([["notes/0001-notes"], ["migrations", "notes"]]);
      }),
  );

  it.effect(
    "fails a call that throws with HubStoreUnavailable, and answers the next one",
    () =>
      Effect.gen(function* () {
        const store = yield* HubStore.HubStore;
        const failed = yield* store
          .use((database) => database.run("INSERT INTO nowhere VALUES (1)"))
          .pipe(Effect.flip);
        const answered = yield* store.use(
          (database) => database.query("SELECT 1 + 1").values()[0]?.[0],
        );
        expect([failed._tag, failed.message, answered]).toEqual([
          "HubStoreUnavailable",
          "no such table: nowhere",
          2,
        ]);
      }).pipe(
        Effect.provide(
          HubStore.layer({ path: join(scratch, "calls.sqlite"), steps: [] }),
        ),
      ),
  );
});

describe("HubStore.migrated", () => {
  const steps: ReadonlyArray<HubStore.Step> = [
    { name: "test/0001-notes", sql: "CREATE TABLE notes (text TEXT)" },
  ];
  const opened = (path: string, listed: ReadonlyArray<HubStore.Step>) =>
    Effect.scoped(Layer.build(HubStore.migrated({ path, steps: listed })));

  it.effect(
    "opens a store at exactly the listed steps, and refuses a missing one or one at other steps, migrating nothing",
    () =>
      Effect.gen(function* () {
        const missing = join(scratch, "migrated-missing.sqlite");
        expect((yield* Effect.flip(opened(missing, steps))).message).toBe(
          `The hub store ${missing} does not exist.`,
        );
        expect(existsSync(missing)).toBe(false);

        const path = join(scratch, "migrated.sqlite");
        yield* Effect.scoped(Layer.build(HubStore.layer({ path, steps })));
        yield* opened(path, steps);

        const more = [
          ...steps,
          { name: "test/0002-tags", sql: "CREATE TABLE tags (text TEXT)" },
        ];
        expect((yield* Effect.flip(opened(path, more))).message).toContain(
          "is not at this hub's steps",
        );
        expect((yield* Effect.flip(opened(path, []))).message).toContain(
          "is not at this hub's steps",
        );
        expect(namesIn(path, "SELECT name FROM migrations")).toEqual([
          "test/0001-notes",
        ]);
      }),
  );
});
