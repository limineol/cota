import { Duration, Option } from "effect";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import * as QuotaLogin from "./quota-login.ts";

/** How long a good quota reading read with a held key stands before the pool is read again. */
const heldKeyPeriod = Duration.seconds(60);

/** How long a good quota reading read with a quota login stands before the pool is read again. */
const loginPeriod = Duration.seconds(120);

/** The quota readers that read with the pool's held key. */
type HeldKeyReader = "zai" | "opencode-go";

type HeldKey = Option.Option.Value<Pool.KeyedPool["key"]>;

/** The quota reader a pool is read with, the credential it reads with (with a held key, the base URL it reads at), and how long a good quota reading stands. */
export type Reader =
  | {
      readonly name: HeldKeyReader;
      readonly key: HeldKey;
      readonly baseUrl: string;
      readonly period: Duration.Duration;
    }
  | {
      readonly name: QuotaLogin.Provider;
      readonly login: QuotaLogin.QuotaLogin;
      readonly period: Duration.Duration;
    };

const heldKeyReaders: ReadonlyMap<string, HeldKeyReader> = new Map([
  ["zai", "zai"],
  ["opencode-go", "opencode-go"],
]);

/**
 * The reader of a keyed pool whose provider is `zai` or `opencode-go` and
 * that holds a key, with that key; of a subscription pool, with its quota
 * login while it has one of the provider it takes that is not expired; none
 * for any other pool, an observed pool among them.
 */
export const readerOf = (
  pool: Pool.Pool,
  login: Option.Option<QuotaLogin.QuotaLogin>,
): Option.Option<Reader> => {
  if (pool.kind === "subscription") {
    return Option.flatMap(QuotaLogin.takenBy(pool), (name) =>
      login.pipe(
        Option.filter(
          (login) => login.provider === name && Option.isNone(login.expiredAt),
        ),
        Option.map((login) => ({ name, login, period: loginPeriod })),
      ),
    );
  }
  if (pool.kind === "observed") return Option.none();
  const name = heldKeyReaders.get(pool.provider);
  if (name === undefined || Option.isNone(pool.key)) return Option.none();
  return Option.some({
    name,
    key: pool.key.value,
    baseUrl: pool.baseUrl,
    period: heldKeyPeriod,
  });
};
