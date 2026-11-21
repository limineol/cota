import { describe, expect, it } from "@effect/vitest";
import {
  Arbitrary,
  Duration,
  Effect,
  Fiber,
  Layer,
  Schema,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { SqlConsole } from "#modules/request-log/02-application/interfaces/sql-console.ts";
import * as Sql from "#modules/request-log/03-domain/sql.ts";
import * as ClickHouseSqlConsole from "./clickhouse-sql-console.ts";
import * as ClickHouse from "./client.ts";

const only = "GRANT SELECT ON cota.* TO cota_sql";

const extraGrants = [
  "GRANT SELECT ON system.* TO cota_sql",
  "GRANT INSERT ON cota.* TO cota_sql",
  "GRANT SELECT ON cota_other.* TO cota_sql",
  "GRANT cota_admin TO cota_sql",
  "GRANT SELECT ON cota.* TO cota_sql WITH GRANT OPTION",
];

const profile = ClickHouseSqlConsole.profileOf(Sql.defaults);

const exactSettings = profile.map(([name, value]) => ({
  name,
  value,
}));

/** The profile's settings with one of them another value, or missing. */
const oneOff = Arbitrary.all({
  at: Arbitrary.schema(
    Schema.Int.check(
      Schema.isBetween({
        minimum: 0,
        maximum: profile.length - 1,
      }),
    ),
  ),
  missing: Arbitrary.schema(Schema.Boolean),
}).pipe(
  Arbitrary.map(({ at, missing }) =>
    exactSettings.flatMap((setting, index) =>
      index !== at
        ? [setting]
        : missing
          ? []
          : [{ ...setting, value: `${setting.value}0` }],
    ),
  ),
);

/**
 * What ClickHouse reports to the SQL user after `prepare`: the profile's
 * settings, or all but one of them, and its grant, with others or without it.
 */
const reported = Arbitrary.all({
  settings: Arbitrary.schema(Schema.Boolean).pipe(
    Arbitrary.flatMap((faithful) =>
      faithful ? Arbitrary.Constant(exactSettings) : oneOff,
    ),
  ),
  keepsItsGrant: Arbitrary.schema(Schema.Boolean),
  extras: Arbitrary.array(
    Arbitrary.schema(
      Schema.Int.check(
        Schema.isBetween({ minimum: 0, maximum: extraGrants.length - 1 }),
      ),
    ),
    { maxLength: 3 },
  ),
});

/**
 * A ClickHouse that takes every command, reports what it is told, and logs
 * what it is sent; unless it answers, a query it streams never ends.
 */
const fakeClickHouse = (
  settings: ReadonlyArray<{ name: string; value: string }>,
  grants: ReadonlyArray<string>,
  sent: Array<string>,
  answers = true,
): ClickHouse.Client => {
  const client: ClickHouse.Client = {
    database: "cota",
    command: (sql) =>
      Effect.sync(() => {
        sent.push(`command ${sql.split(" ").slice(0, 3).join(" ")}`);
      }),
    insert: () => Effect.die("the SQL console never inserts"),
    select: (sql, schema) =>
      Effect.gen(function* () {
        sent.push(`select ${sql}`);
        const rows: ReadonlyArray<unknown> = sql.includes("system.settings")
          ? settings
          : sql === "SHOW GRANTS"
            ? grants.map((grant) => ({ "GRANTS FORMAT JSONEachRow": grant }))
            : [];
        return yield* Schema.decodeUnknownEffect(Schema.Array(schema))(
          rows,
        ).pipe(Effect.orDie);
      }),
    stream: (sql) =>
      Effect.gen(function* () {
        sent.push(`stream ${sql}`);
        if (!answers) return yield* Effect.never;
        return { format: "", exceptionTag: undefined, body: Stream.empty };
      }),
    upload: () => Effect.die("the SQL console never uploads"),
    session: () => client,
    as: () => client,
  };
  return client;
};

describe("making the SQL user", () => {
  it.effect.prop(
    "X6: unless the SQL user has exactly the profile's settings and its one grant, no query is sent and both endpoints are unavailable",
    { reported },
    ({ reported: { settings, keepsItsGrant, extras } }) =>
      Effect.gen(function* () {
        const grants = [
          ...(keepsItsGrant ? [only] : []),
          ...extras.map((at) => extraGrants[at] ?? only),
        ];
        const sent: Array<string> = [];
        const { ran, schema } = yield* Effect.gen(function* () {
          const console = yield* SqlConsole;
          return {
            ran: yield* Effect.result(console.run("SELECT 1")),
            schema: yield* Effect.result(console.schema),
          };
        }).pipe(
          Effect.provide(
            ClickHouseSqlConsole.layer(Sql.defaults).pipe(
              Layer.provide(
                Layer.succeed(
                  ClickHouse.ClickHouse,
                  fakeClickHouse(settings, grants, sent),
                ),
              ),
            ),
          ),
        );

        const exact =
          settings.length === profile.length &&
          settings.every(({ name, value }) =>
            profile.some(
              ([setting, wanted]) => setting === name && wanted === value,
            ),
          ) &&
          grants.length === 1 &&
          grants[0] === only;
        const queried = sent.filter(
          (line) =>
            line.startsWith("stream") || line.includes("FROM system.tables"),
        );
        if (exact) {
          expect([ran._tag, schema._tag]).toEqual(["Success", "Success"]);
          expect(queried).toEqual([
            "stream SELECT 1",
            expect.stringContaining("FROM system.tables"),
          ]);
        } else {
          expect([
            ran._tag === "Failure" && ran.failure._tag,
            schema._tag === "Failure" && schema.failure._tag,
          ]).toEqual(["SqlUnavailable", "SqlUnavailable"]);
          expect(queried).toEqual([]);
        }
      }),
  );

  it.effect(
    "waits for an answer five seconds past the query's time, then answers that ClickHouse did not finish",
    () =>
      Effect.gen(function* () {
        const limits = { ...Sql.defaults, queryTime: Duration.seconds(2) };
        const settings = ClickHouseSqlConsole.profileOf(limits).map(
          ([name, value]) => ({ name, value }),
        );
        const running = yield* Effect.gen(function* () {
          const console = yield* SqlConsole;
          return yield* Effect.result(console.run("SELECT sleep(3)"));
        }).pipe(
          Effect.provide(
            ClickHouseSqlConsole.layer(limits).pipe(
              Layer.provide(
                Layer.succeed(
                  ClickHouse.ClickHouse,
                  fakeClickHouse(settings, [only], [], false),
                ),
              ),
            ),
          ),
          Effect.forkChild,
        );

        yield* TestClock.adjust("6999 millis");
        expect(running.pollUnsafe()).toBeUndefined();
        yield* TestClock.adjust("1 millis");
        const ran = yield* Fiber.join(running);
        expect(
          ran._tag === "Failure" &&
            ran.failure._tag === "SqlUnavailable" &&
            ran.failure.detail,
        ).toBe("ClickHouse did not finish answering within 7s.");
      }),
  );
});
