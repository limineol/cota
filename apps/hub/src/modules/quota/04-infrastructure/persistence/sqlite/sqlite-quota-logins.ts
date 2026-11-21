import type { Database } from "bun:sqlite";
import { DateTime, Effect, Layer, Option, Redacted, Schema } from "effect";
import { QuotaLogins } from "#modules/quota/02-application/interfaces/quota-logins.ts";
import {
  Generation,
  Provider,
  type QuotaLogin,
} from "#modules/quota/03-domain/quota-login.ts";
import { PoolId } from "#shared/03-domain/ids.ts";
import {
  HubStore,
  type Step,
} from "#shared/04-infrastructure/hub-store/hub-store.ts";

export const steps: ReadonlyArray<Step> = [
  {
    name: "quota/0001-quota-logins",
    sql: `CREATE TABLE quota_logins (
  pool TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  account_id TEXT,
  subscription_type TEXT,
  rate_limit_tier TEXT,
  given_at TEXT NOT NULL,
  generation TEXT NOT NULL,
  refreshed_at TEXT,
  expired_at TEXT
)`,
  },
];

const Row = Schema.Struct({
  pool: PoolId,
  provider: Provider,
  access_token: Schema.String,
  refresh_token: Schema.String,
  ends_at: Schema.String,
  account_id: Schema.NullOr(Schema.String),
  subscription_type: Schema.NullOr(Schema.String),
  rate_limit_tier: Schema.NullOr(Schema.String),
  given_at: Schema.String,
  generation: Generation,
  refreshed_at: Schema.NullOr(Schema.String),
  expired_at: Schema.NullOr(Schema.String),
});

const decodeRow = Schema.decodeUnknownSync(Row);

const time = (iso: string) => DateTime.makeUnsafe(iso);
const timeOrNone = (iso: string | null) =>
  Option.map(Option.fromNullishOr(iso), time);
const iso = (at: DateTime.Utc) => DateTime.formatIso(at);
const isoOrNull = (at: Option.Option<DateTime.Utc>) =>
  Option.getOrNull(Option.map(at, iso));

const loginOf = (value: unknown): QuotaLogin => {
  const row = decodeRow(value);
  const common = {
    pool: row.pool,
    accessToken: Redacted.make(row.access_token),
    refreshToken: Redacted.make(row.refresh_token),
    endsAt: time(row.ends_at),
    givenAt: time(row.given_at),
    generation: row.generation,
    refreshedAt: timeOrNone(row.refreshed_at),
    expiredAt: timeOrNone(row.expired_at),
  };
  if (row.provider === "anthropic") {
    return {
      ...common,
      provider: "anthropic",
      subscriptionType: Option.fromNullishOr(row.subscription_type),
      rateLimitTier: Option.fromNullishOr(row.rate_limit_tier),
    };
  }
  if (row.account_id === null) {
    throw new Error(`the ChatGPT quota login of ${row.pool} has no account id`);
  }
  return {
    ...common,
    provider: "chatgpt",
    accountId: Redacted.make(row.account_id),
  };
};

const columns =
  "pool, provider, access_token, refresh_token, ends_at, account_id, subscription_type, rate_limit_tier, given_at, generation, refreshed_at, expired_at";

const select = (database: Database, where: string, ...values: Array<string>) =>
  database
    .query(`SELECT ${columns} FROM quota_logins ${where}`)
    .all(...values)
    .map(loginOf);

/**
 * Moves what the write-ahead log holds into the store and empties it, so that
 * a login just forgotten or replaced is left in neither file: the store
 * overwrites deleted rows (`secure_delete`), and the log would otherwise keep
 * their pages until a later checkpoint.
 */
const checkpoint = (database: Database) => {
  database.run("PRAGMA wal_checkpoint(TRUNCATE)");
};

/** Quota logins in the hub store's `quota_logins` table (`docs/specs/quota-logins/spec.md`). */
export const layer: Layer.Layer<QuotaLogins, never, HubStore> = Layer.effect(
  QuotaLogins,
  Effect.gen(function* () {
    const store = yield* HubStore;
    return QuotaLogins.of({
      all: store.use((database) => select(database, "ORDER BY pool")),
      find: (pool) =>
        store.use((database) =>
          Option.fromNullishOr(select(database, "WHERE pool = ?", pool)[0]),
        ),
      give: (login) =>
        store.use((database) => {
          database
            .query(
              `INSERT OR REPLACE INTO quota_logins (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              login.pool,
              login.provider,
              Redacted.value(login.accessToken),
              Redacted.value(login.refreshToken),
              iso(login.endsAt),
              login.provider === "chatgpt"
                ? Redacted.value(login.accountId)
                : null,
              login.provider === "anthropic"
                ? Option.getOrNull(login.subscriptionType)
                : null,
              login.provider === "anthropic"
                ? Option.getOrNull(login.rateLimitTier)
                : null,
              iso(login.givenAt),
              login.generation,
              isoOrNull(login.refreshedAt),
              isoOrNull(login.expiredAt),
            );
          checkpoint(database);
        }),
      update: ({ next, over }) =>
        store.use(
          (database) =>
            database
              .query(
                `UPDATE quota_logins SET access_token = ?, refresh_token = ?, ends_at = ?, refreshed_at = ?, expired_at = ?
WHERE pool = ? AND generation = ? AND refresh_token IN (${over.map(() => "?").join(", ")})`,
              )
              .run(
                Redacted.value(next.accessToken),
                Redacted.value(next.refreshToken),
                iso(next.endsAt),
                isoOrNull(next.refreshedAt),
                isoOrNull(next.expiredAt),
                next.pool,
                next.generation,
                ...over.map(Redacted.value),
              ).changes > 0,
        ),
      forget: (pool) =>
        store.use((database) => {
          const had =
            database.query("DELETE FROM quota_logins WHERE pool = ?").run(pool)
              .changes > 0;
          checkpoint(database);
          return had;
        }),
    });
  }),
);
