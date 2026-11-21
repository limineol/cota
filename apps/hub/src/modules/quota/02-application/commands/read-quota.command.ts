import { Context, Effect, Layer, Option } from "effect";
import { QuotaReader } from "#modules/quota/02-application/interfaces/quota-reader.ts";
import type * as Readers from "#modules/quota/03-domain/readers.ts";
import type {
  QuotaLoginExpired,
  ReadFailure,
} from "#modules/quota/03-domain/readings.ts";
import type { QuotaReading } from "#modules/quota/03-domain/sources.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import { RefreshQuotaLogin } from "./refresh-quota-login.command.ts";

export class ReadQuota extends Context.Service<
  ReadQuota,
  {
    /**
     * Reads a pool's usage endpoint with its reader: with a held key, one
     * call; with a quota login, the login made fresh first (G5), and after a
     * 401 the login refreshed and one call more, never a third (G6).
     */
    readonly execute: (
      pool: Pool.Pool,
      reader: Readers.Reader,
    ) => Effect.Effect<QuotaReading, ReadFailure | QuotaLoginExpired>;
  }
>()("@cota/hub/quota/ReadQuota") {}

export const layer: Layer.Layer<
  ReadQuota,
  never,
  QuotaReader | RefreshQuotaLogin
> = Layer.effect(
  ReadQuota,
  Effect.gen(function* () {
    const quotaReader = yield* QuotaReader;
    const refreshQuotaLogin = yield* RefreshQuotaLogin;

    return ReadQuota.of({
      execute: Effect.fn("ReadQuota.execute")(function* (
        pool: Pool.Pool,
        reader: Readers.Reader,
      ) {
        if ("key" in reader) return yield* quotaReader.read(pool, reader);
        const login = yield* refreshQuotaLogin.execute(pool, Option.none());
        const first = yield* Effect.result(
          quotaReader.read(pool, { ...reader, login }),
        );
        if (first._tag === "Success") return first.success;
        if (
          first.failure._tag === "ReadFailure" &&
          first.failure.kind === "refused"
        ) {
          const refreshed = yield* refreshQuotaLogin.execute(
            pool,
            Option.some(login.accessToken),
          );
          return yield* quotaReader.read(pool, { ...reader, login: refreshed });
        }
        return yield* first.failure;
      }),
    });
  }),
);
