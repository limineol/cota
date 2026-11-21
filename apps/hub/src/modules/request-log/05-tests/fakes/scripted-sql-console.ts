import { Context, Effect, Layer, Option } from "effect";
import {
  type FormatNotAllowed,
  QueryFailed,
  SqlConsole,
  SqlUnavailable,
} from "#modules/request-log/02-application/interfaces/sql-console.ts";
import type * as Sql from "#modules/request-log/03-domain/sql.ts";

/** What the fake answers a text with. */
export type Outcome = Effect.Effect<Sql.Answer, QueryFailed | FormatNotAllowed>;

export interface Script {
  /** Why SQL is unavailable; none while it is available. */
  unavailable: Option.Option<string>;
  readonly answers: Map<string, Outcome>;
  schema: Sql.DatabaseSchema;
  /** Every text run, in order. */
  readonly sent: Array<string>;
}

export class ScriptedSqlConsole extends Context.Service<
  ScriptedSqlConsole,
  { readonly script: Script; readonly reset: () => void }
>()("@cota/hub/request-log/ScriptedSqlConsole") {}

const fresh = (script: Script) => {
  script.unavailable = Option.none();
  script.answers.clear();
  script.schema = { database: "cota", tables: [] };
  script.sent.length = 0;
};

/**
 * A SQL console that answers each text as its script says, and fails a text
 * it has no answer for as ClickHouse fails one it cannot parse.
 */
export const layer: Layer.Layer<SqlConsole | ScriptedSqlConsole> =
  Layer.effectContext(
    Effect.sync(() => {
      const script: Script = {
        unavailable: Option.none(),
        answers: new Map(),
        schema: { database: "cota", tables: [] },
        sent: [],
      };
      const ready = Effect.suspend(() =>
        Option.match(script.unavailable, {
          onNone: () => Effect.void,
          onSome: (detail) => Effect.fail(new SqlUnavailable({ detail })),
        }),
      );
      return Context.make(
        SqlConsole,
        SqlConsole.of({
          run: (sql) =>
            Effect.gen(function* () {
              yield* ready;
              script.sent.push(sql);
              return yield* script.answers.get(sql) ??
                new QueryFailed({
                  detail:
                    "Code: 62. DB::Exception: Syntax error: the script has no answer for this text. (SYNTAX_ERROR)",
                });
            }),
          schema: Effect.andThen(
            ready,
            Effect.sync(() => script.schema),
          ),
        }),
      ).pipe(
        Context.add(
          ScriptedSqlConsole,
          ScriptedSqlConsole.of({ script, reset: () => fresh(script) }),
        ),
      );
    }),
  );
