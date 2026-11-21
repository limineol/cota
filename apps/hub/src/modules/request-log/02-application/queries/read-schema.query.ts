import { Context, Effect, Layer } from "effect";
import {
  SqlConsole,
  type SqlUnavailable,
} from "#modules/request-log/02-application/interfaces/sql-console.ts";
import type * as Sql from "#modules/request-log/03-domain/sql.ts";

export class ReadSchema extends Context.Service<
  ReadSchema,
  {
    readonly execute: Effect.Effect<Sql.DatabaseSchema, SqlUnavailable>;
  }
>()("@cota/hub/request-log/ReadSchema") {}

export const layer = Layer.effect(
  ReadSchema,
  Effect.gen(function* () {
    const console = yield* SqlConsole;
    return ReadSchema.of({
      execute: console.schema.pipe(Effect.withSpan("ReadSchema.execute")),
    });
  }),
);
