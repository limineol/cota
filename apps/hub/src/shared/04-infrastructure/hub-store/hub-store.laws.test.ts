import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Layer, Result, Schema } from "effect";
import { TestClock } from "effect/testing";
import * as Hub from "#hub.ts";
import * as SignIn from "#modules/sign-in/module.ts";
import * as HubStore from "./hub-store.ts";

const scratch = mkdtempSync(join(tmpdir(), "cota-hub-store-laws-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let stores = 0;
const freshPath = () => {
  stores += 1;
  return join(scratch, `${stores}.sqlite`);
};

const flag = Arbitrary.schema(Schema.Boolean);
const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));
const shapes = Arbitrary.array(flag, { minLength: 1, maxLength: 6 });

const stepsOf = (
  module: string,
  shapes: ReadonlyArray<boolean>,
): ReadonlyArray<HubStore.Step> =>
  shapes.map((ownTable, index) => {
    const name = `${module}/${String(index + 1).padStart(4, "0")}-step`;
    const table = `${module}_${index + 1}`;
    return {
      name,
      sql: [
        "CREATE TABLE IF NOT EXISTS trail (step TEXT NOT NULL);",
        `INSERT INTO trail (step) VALUES ('${name}');`,
        ...(ownTable
          ? [
              `CREATE TABLE ${table} (step INTEGER NOT NULL);`,
              `INSERT INTO ${table} (step) VALUES (${index + 1});`,
            ]
          : []),
      ].join(" "),
    };
  });

const start = (path: string, steps: ReadonlyArray<HubStore.Step>) =>
  Effect.scoped(Layer.build(HubStore.layer({ path, steps })));

const contentsOf = (path: string): string => {
  const database = new Database(path, { readonly: true });
  try {
    const schema = database
      .query("SELECT type, name, sql FROM sqlite_master ORDER BY name")
      .values();
    return JSON.stringify(
      schema.map(([type, name, sql]) => [
        type,
        name,
        sql,
        type === "table"
          ? database
              .query(`SELECT * FROM "${String(name)}" ORDER BY rowid`)
              .values()
          : [],
      ]),
    );
  } finally {
    database.close();
  }
};

const columnOf = (path: string, table: string): ReadonlyArray<string> => {
  const database = new Database(path, { readonly: true });
  try {
    const exists = database
      .query("SELECT 1 FROM sqlite_master WHERE name = ?")
      .values(table);
    if (exists.length === 0) return [];
    const column = table === "migrations" ? "name" : "step";
    return database
      .query(`SELECT ${column} FROM ${table} ORDER BY rowid`)
      .values()
      .map(([value]) => String(value));
  } finally {
    database.close();
  }
};

const runs = { arbitrary: { runs: 100 } };

describe("hub store laws", () => {
  it.effect.prop(
    "M1: opening a store that holds every step the hub lists runs no step and leaves every table as it was",
    { shapes },
    ({ shapes }) =>
      Effect.gen(function* () {
        const path = freshPath();
        const steps = stepsOf("trail", shapes);
        yield* start(path, steps);
        const before = contentsOf(path);
        yield* TestClock.adjust("1 hour");
        yield* start(path, steps);
        return contentsOf(path) === before;
      }),
    runs,
  );

  it.effect.prop(
    "M2: after any sequence of starts, each with a list that begins with the one before, every step has run exactly once, and in the listed order",
    {
      shapes,
      starts: Arbitrary.array(int(0, 6), { minLength: 1, maxLength: 4 }),
    },
    ({ shapes, starts }) =>
      Effect.gen(function* () {
        const path = freshPath();
        const steps = stepsOf("trail", shapes);
        const lengths = starts
          .map((length) => Math.min(length, steps.length))
          .sort((a, b) => a - b);
        for (const length of lengths) {
          yield* start(path, steps.slice(0, length));
          yield* TestClock.adjust("1 minute");
        }
        const listed = steps
          .slice(0, lengths.at(-1))
          .map(({ name }) => name)
          .join();
        return (
          columnOf(path, "trail").join() === listed &&
          columnOf(path, "migrations").join() === listed
        );
      }),
    runs,
  );

  it.effect.prop(
    "M3: a store holding a step the hub does not list stops the start, and nothing in it changes",
    {
      scene: Arbitrary.all({
        shapes,
        kept: Arbitrary.array(flag, { minLength: 6, maxLength: 6 }),
        later: Arbitrary.array(flag, { minLength: 0, maxLength: 2 }),
      }).pipe(
        Arbitrary.filter(({ shapes, kept }) =>
          shapes.some((_, index) => kept[index] === false),
        ),
      ),
    },
    ({ scene: { shapes, kept, later } }) =>
      Effect.gen(function* () {
        const path = freshPath();
        const steps = stepsOf("trail", shapes);
        yield* start(path, steps);
        const before = contentsOf(path);
        yield* TestClock.adjust("1 hour");
        const older = [
          ...steps.filter((_, index) => kept[index]),
          ...stepsOf("later", later),
        ];
        const started = yield* Effect.result(start(path, older));
        return (
          Result.isFailure(started) &&
          started.failure.problem.startsWith("was written by a newer hub") &&
          contentsOf(path) === before
        );
      }),
    runs,
  );

  it.effect("M4: a store the hub creates has mode 0600", () =>
    Effect.gen(function* () {
      const path = freshPath();
      yield* start(path, stepsOf("trail", [true]));
      expect((statSync(path).mode & 0o777).toString(8)).toBe("600");
    }),
  );

  describe("with the steps the hub lists", () => {
    const signInOnly = SignIn.steps.slice(0, 1);
    const addSignIn = (path: string) => {
      const database = new Database(path);
      try {
        database.run(
          "INSERT INTO sign_ins VALUES ('01a1cd0d-dc00-7000-8000-000000000001', 'digest', 'a', 'b', 'c', NULL, 'Firefox')",
        );
      } finally {
        database.close();
      }
    };

    const userAgentsOf = (path: string) => {
      const database = new Database(path, { readonly: true });
      try {
        return database.query("SELECT user_agent FROM sign_ins").values();
      } finally {
        database.close();
      }
    };

    it.effect(
      "M1: opening a store that holds every step the hub lists runs no step and leaves every table as it was, with the hub's own steps",
      () =>
        Effect.gen(function* () {
          const path = freshPath();
          yield* start(path, Hub.storeSteps);
          addSignIn(path);
          const before = contentsOf(path);
          yield* TestClock.adjust("1 hour");
          yield* start(path, Hub.storeSteps);
          expect(contentsOf(path)).toBe(before);
        }),
    );

    it.effect(
      "M2: a store that holds only the sign-in module's first step gains the others once each, keeping its sign-ins",
      () =>
        Effect.gen(function* () {
          const path = freshPath();
          yield* start(path, signInOnly);
          addSignIn(path);
          yield* TestClock.adjust("1 minute");
          yield* start(path, Hub.storeSteps);
          yield* TestClock.adjust("1 minute");
          yield* start(path, Hub.storeSteps);
          expect([columnOf(path, "migrations"), userAgentsOf(path)]).toEqual([
            [
              "sign-in/0001-sign-ins",
              "sign-in/0002-owner-password",
              "sign-in/0003-passkeys",
              "display-names/0001-display-names",
              "quota/0001-quota-logins",
              "routes/0001-routes",
            ],
            [["Firefox"]],
          ]);
        }),
    );

    it.effect(
      "M2: a store migrated before the stored password gains its step, once, keeping its sign-ins",
      () =>
        Effect.gen(function* () {
          const path = freshPath();
          const released = Hub.storeSteps.filter(
            ({ name }) =>
              name !== "sign-in/0002-owner-password" &&
              name !== "sign-in/0003-passkeys",
          );
          yield* start(path, released);
          addSignIn(path);
          yield* TestClock.adjust("1 minute");
          yield* start(path, Hub.storeSteps);
          yield* start(path, Hub.storeSteps);
          expect([columnOf(path, "migrations"), userAgentsOf(path)]).toEqual([
            [
              "sign-in/0001-sign-ins",
              "display-names/0001-display-names",
              "quota/0001-quota-logins",
              "routes/0001-routes",
              "sign-in/0002-owner-password",
              "sign-in/0003-passkeys",
            ],
            [["Firefox"]],
          ]);
        }),
    );

    it.effect(
      "M2: a store migrated before passkeys gains their step, once, keeping its sign-ins and its stored password",
      () =>
        Effect.gen(function* () {
          const path = freshPath();
          const released = Hub.storeSteps.filter(
            ({ name }) => name !== "sign-in/0003-passkeys",
          );
          yield* start(path, released);
          addSignIn(path);
          const database = new Database(path);
          database.run(
            "INSERT INTO owner_password (id, hash, set_at) VALUES (1, 'kept-hash', '2026-11-17T00:00:00.000Z')",
          );
          database.close();
          yield* TestClock.adjust("1 minute");
          yield* start(path, Hub.storeSteps);
          yield* start(path, Hub.storeSteps);
          const after = new Database(path, { readonly: true });
          const hashes = after
            .query("SELECT hash FROM owner_password")
            .values()
            .map(([hash]) => String(hash));
          after.close();
          expect([
            columnOf(path, "migrations"),
            userAgentsOf(path),
            hashes,
          ]).toEqual([
            [
              "sign-in/0001-sign-ins",
              "sign-in/0002-owner-password",
              "display-names/0001-display-names",
              "quota/0001-quota-logins",
              "routes/0001-routes",
              "sign-in/0003-passkeys",
            ],
            [["Firefox"]],
            ["kept-hash"],
          ]);
        }),
    );

    it.effect(
      "M3: a store this hub migrated is refused by a hub that lists only the sign-in module's step, and nothing in it changes",
      () =>
        Effect.gen(function* () {
          const path = freshPath();
          yield* start(path, Hub.storeSteps);
          const before = contentsOf(path);
          const started = yield* Effect.result(start(path, signInOnly));
          expect([
            Result.isFailure(started) && started.failure.problem,
            contentsOf(path),
          ]).toEqual([
            "was written by a newer hub: it holds display-names/0001-display-names, quota/0001-quota-logins, routes/0001-routes, sign-in/0002-owner-password, sign-in/0003-passkeys, which this hub does not know",
            before,
          ]);
        }),
    );
  });
});
