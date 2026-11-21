import { expect, layer } from "@effect/vitest";
import { Effect, Option } from "effect";
import {
  FormatNotAllowed,
  QueryFailed,
} from "#modules/request-log/02-application/interfaces/sql-console.ts";
import { ScriptedSqlConsole } from "#modules/request-log/05-tests/fakes/scripted-sql-console.ts";
import * as Harness from "#shared/05-tests/harness.ts";

const reader = { "x-cota-key": Harness.secrets.readerHubKey };

const scripted = Effect.gen(function* () {
  const { script, reset } = yield* ScriptedSqlConsole;
  reset();
  return script;
});

const postSql = (sql: string, headers: Record<string, string> = reader) =>
  Harness.send("/api/sql", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ sql }),
  });

const answer = {
  columns: [
    { name: "pool", type: "LowCardinality(String)" },
    { name: "requests", type: "UInt64" },
    { name: "first", type: "Nullable(DateTime64(3, 'UTC'))" },
  ],
  rows: [
    ["claude", "12", "2026-11-12T00:00:00.000Z"],
    ["codex", "3", null],
  ],
  truncated: true,
  elapsedMs: 7,
};

layer(Harness.layer())("the sql group", (it) => {
  it.effect(
    "runs a reader key's SQL and answers its columns, rows and whether rows were left out",
    () =>
      Effect.gen(function* () {
        const script = yield* scripted;
        const sql =
          "SELECT pool, count() AS requests, min(started_at) AS first FROM requests GROUP BY pool";
        script.answers.set(sql, Effect.succeed(answer));
        const client = yield* Harness.api(reader);

        expect(yield* client.sql.sql({ payload: { sql } })).toEqual(answer);
        expect(script.sent).toEqual([sql]);
      }),
  );

  it.effect(
    "lets the owner and a reader key call both endpoints, and no one else",
    () =>
      Effect.gen(function* () {
        const script = yield* scripted;
        script.answers.set("SELECT 1", Effect.succeed({ ...answer, rows: [] }));
        const owner = yield* Harness.signIn();
        const callers: ReadonlyArray<
          readonly [string, Record<string, string>]
        > = [
          ["no caller", {}],
          ["keyed hub key", { "x-cota-key": Harness.secrets.fleetHubKey }],
          [
            "subscription hub key",
            { "x-cota-key": Harness.secrets.clientsHubKey },
          ],
          ["reader key", reader],
          [
            "reader key as a bearer",
            { authorization: `Bearer ${Harness.secrets.readerHubKey}` },
          ],
          ["owner", owner],
          [
            "owner from another site",
            { ...owner, "sec-fetch-site": "cross-site" },
          ],
        ];
        const seen: Array<string> = [];
        for (const [who, headers] of callers) {
          const posted = yield* Harness.problemOf(
            yield* postSql("SELECT 1", headers),
          );
          const schema = yield* Harness.problemOf(
            yield* Harness.send("/api/schema", { headers }),
          );
          const typeOf = (body: unknown) =>
            typeof body === "object" && body !== null && "type" in body
              ? String(body.type)
              : "answer";
          seen.push(
            `${who}: sql ${posted.status} ${typeOf(posted.body)}, schema ${schema.status} ${typeOf(schema.body)}`,
          );
        }
        expect(seen).toEqual([
          "no caller: sql 401 urn:cota:sign-in-required, schema 401 urn:cota:sign-in-required",
          "keyed hub key: sql 403 urn:cota:not-allowed, schema 403 urn:cota:not-allowed",
          "subscription hub key: sql 403 urn:cota:not-allowed, schema 403 urn:cota:not-allowed",
          "reader key: sql 200 answer, schema 200 answer",
          "reader key as a bearer: sql 200 answer, schema 200 answer",
          "owner: sql 200 answer, schema 200 answer",
          "owner from another site: sql 403 urn:cota:cross-site, schema 200 answer",
        ]);
        expect(script.sent).toEqual(["SELECT 1", "SELECT 1", "SELECT 1"]);
      }),
  );

  it.effect(
    "takes 100,000 characters, counted as code points, and answers 400 query-too-long to one more without running it",
    () =>
      Effect.gen(function* () {
        const script = yield* scripted;
        const longest = `SELECT '${"🦊".repeat(99_991)}'`;
        expect([...longest].length).toBe(100_000);
        script.answers.set(longest, Effect.succeed(answer));

        expect((yield* postSql(longest)).status).toBe(200);
        expect(yield* Harness.problemOf(yield* postSql(`${longest} `))).toEqual(
          {
            status: 400,
            contentType: "application/problem+json",
            body: {
              type: "urn:cota:query-too-long",
              status: 400,
              title: "The SQL is longer than 100,000 characters.",
              detail:
                "The SQL is 100001 characters long; at most 100000 are run.",
            },
          },
        );
        expect(script.sent).toEqual([longest]);
        expect(
          (yield* Harness.problemOf(yield* postSql(""))).body,
        ).toMatchObject({ type: "about:blank", status: 400 });
      }),
  );

  it.effect(
    "answers a query ClickHouse refused, and one that names its own format, as 400 problems",
    () =>
      Effect.gen(function* () {
        const script = yield* scripted;
        script.answers.set(
          "DROP TABLE requests",
          Effect.fail(
            new QueryFailed({
              detail:
                "Code: 497. DB::Exception: cota_sql: Not enough privileges. To execute this query, it's necessary to have the grant DROP TABLE ON cota.requests. (ACCESS_DENIED)",
            }),
          ),
        );
        script.answers.set(
          "SELECT 1 FORMAT CSV",
          Effect.fail(new FormatNotAllowed({ format: "CSV" })),
        );

        expect(
          yield* Harness.problemOf(yield* postSql("DROP TABLE requests")),
        ).toEqual({
          status: 400,
          contentType: "application/problem+json",
          body: {
            type: "urn:cota:query-failed",
            status: 400,
            title: "ClickHouse refused or stopped the query.",
            detail:
              "Code: 497. DB::Exception: cota_sql: Not enough privileges. To execute this query, it's necessary to have the grant DROP TABLE ON cota.requests. (ACCESS_DENIED)",
          },
        });
        expect(
          yield* Harness.problemOf(yield* postSql("SELECT 1 FORMAT CSV")),
        ).toEqual({
          status: 400,
          contentType: "application/problem+json",
          body: {
            type: "urn:cota:format-not-allowed",
            status: 400,
            title:
              "The query names its own FORMAT; leave the format to the hub.",
            detail:
              "ClickHouse answered in CSV; remove the query's FORMAT clause, and the hub reads the answer as JSON.",
          },
        });
      }),
  );

  it.effect(
    "answers the schema as the SQL user sees it, a view with no totals",
    () =>
      Effect.gen(function* () {
        const script = yield* scripted;
        script.schema = {
          database: "cota",
          tables: [
            {
              name: "requests",
              engine: "MergeTree",
              rows: Option.some(1200),
              bytes: Option.some(84_000),
              comment: "",
              columns: [
                { name: "id", type: "UUID", comment: "" },
                { name: "pool", type: "LowCardinality(String)", comment: "" },
              ],
            },
            {
              name: "sessions",
              engine: "View",
              rows: Option.none(),
              bytes: Option.none(),
              comment: "every session",
              columns: [{ name: "session", type: "String", comment: "" }],
            },
          ],
        };
        const client = yield* Harness.api(reader);

        expect(yield* client.sql.schema()).toEqual({
          database: "cota",
          tables: [
            {
              name: "requests",
              engine: "MergeTree",
              rows: 1200,
              bytes: 84_000,
              comment: "",
              columns: [
                { name: "id", type: "UUID", comment: "" },
                { name: "pool", type: "LowCardinality(String)", comment: "" },
              ],
            },
            {
              name: "sessions",
              engine: "View",
              rows: null,
              bytes: null,
              comment: "every session",
              columns: [{ name: "session", type: "String", comment: "" }],
            },
          ],
        });
      }),
  );

  it.effect(
    "answers 503 sql-unavailable from both endpoints, saying why, while every other endpoint answers",
    () =>
      Effect.gen(function* () {
        const script = yield* scripted;
        const detail =
          "The hub's ClickHouse user could not create the settings profile cota_sql; it needs access management (ClickHouse error 497).";
        script.unavailable = Option.some(detail);
        const unavailable = {
          status: 503,
          contentType: "application/problem+json",
          body: {
            type: "urn:cota:sql-unavailable",
            status: 503,
            title: "SQL is unavailable.",
            detail,
          },
        };

        expect(yield* Harness.problemOf(yield* postSql("SELECT 1"))).toEqual(
          unavailable,
        );
        expect(
          yield* Harness.problemOf(
            yield* Harness.send("/api/schema", { headers: reader }),
          ),
        ).toEqual(unavailable);
        expect(script.sent).toEqual([]);
        for (const path of ["/api/me", "/api/overview", "/api/sessions"]) {
          expect(
            `${path} ${(yield* Harness.send(path, { headers: reader })).status}`,
          ).toBe(`${path} 200`);
        }
      }),
  );
});
