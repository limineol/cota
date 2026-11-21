import { DateTime, Effect, Layer, Option, Schema } from "effect";
import { SignIns } from "#modules/sign-in/02-application/interfaces/sign-ins.repository.ts";
import {
  type SignIn,
  TokenDigest,
} from "#modules/sign-in/03-domain/sign-in.entity.ts";
import { SignInId } from "#shared/03-domain/ids.ts";
import {
  HubStore,
  type Step,
} from "#shared/04-infrastructure/hub-store/hub-store.ts";

export const steps: ReadonlyArray<Step> = [
  {
    name: "sign-in/0001-sign-ins",
    sql: `CREATE TABLE sign_ins (
  id TEXT PRIMARY KEY,
  token_digest TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  revoked_at TEXT,
  user_agent TEXT NOT NULL
)`,
  },
];

const Row = Schema.Struct({
  id: SignInId,
  token_digest: TokenDigest,
  created_at: Schema.DateTimeUtcFromString,
  expires_at: Schema.DateTimeUtcFromString,
  last_used_at: Schema.DateTimeUtcFromString,
  revoked_at: Schema.NullOr(Schema.DateTimeUtcFromString),
  user_agent: Schema.String,
});

const decodeRow = Schema.decodeUnknownSync(Row);

const signInOf = (row: unknown): SignIn => {
  const decoded = decodeRow(row);
  return {
    id: decoded.id,
    tokenDigest: decoded.token_digest,
    createdAt: decoded.created_at,
    expiresAt: decoded.expires_at,
    lastUsedAt: decoded.last_used_at,
    revokedAt: Option.fromNullOr(decoded.revoked_at),
    userAgent: decoded.user_agent,
  };
};

const columns =
  "id, token_digest, created_at, expires_at, last_used_at, revoked_at, user_agent";

const iso = DateTime.formatIso;

/** Sign-ins in the hub store's `sign_ins` table (`docs/specs/hub-store/spec.md`). */
export const layer: Layer.Layer<SignIns, never, HubStore> = Layer.effect(
  SignIns,
  Effect.gen(function* () {
    const store = yield* HubStore;
    return SignIns.of({
      add: (signIn) =>
        store.use((database) => {
          const id = SignInId.make(
            Bun.randomUUIDv7("hex", DateTime.toEpochMillis(signIn.createdAt)),
          );
          database
            .query(
              `INSERT INTO sign_ins (${columns}) VALUES (?, ?, ?, ?, ?, NULL, ?)`,
            )
            .run(
              id,
              signIn.tokenDigest,
              iso(signIn.createdAt),
              iso(signIn.expiresAt),
              iso(signIn.lastUsedAt),
              signIn.userAgent,
            );
          return { ...signIn, id, revokedAt: Option.none() };
        }),
      findByDigest: (digest) =>
        store.use((database) =>
          Option.map(
            Option.fromNullOr(
              database
                .query(`SELECT ${columns} FROM sign_ins WHERE token_digest = ?`)
                .get(digest),
            ),
            signInOf,
          ),
        ),
      all: store.use((database) =>
        database.query(`SELECT ${columns} FROM sign_ins`).all().map(signInOf),
      ),
      touch: (id, at) =>
        store.use((database) => {
          database
            .query("UPDATE sign_ins SET last_used_at = ? WHERE id = ?")
            .run(iso(at), id);
        }),
      revoke: (ids, at) =>
        store.use((database) => {
          const revoke = database.query(
            "UPDATE sign_ins SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
          );
          database.transaction(() => {
            for (const id of ids) revoke.run(iso(at), id);
          })();
        }),
      forget: (endedBefore) =>
        store.use((database) => {
          database
            .query(
              "DELETE FROM sign_ins WHERE revoked_at < ? OR expires_at < ?",
            )
            .run(iso(endedBefore), iso(endedBefore));
        }),
    });
  }),
);
