import { DateTime, Effect, Layer, Option, Schema } from "effect";
import { Passkeys } from "#modules/sign-in/02-application/interfaces/passkeys.repository.ts";
import {
  CredentialId,
  type Passkey,
} from "#modules/sign-in/03-domain/passkey.ts";
import { PasskeyId } from "#shared/03-domain/ids.ts";
import {
  HubStore,
  type Step,
} from "#shared/04-infrastructure/hub-store/hub-store.ts";

export const steps: ReadonlyArray<Step> = [
  {
    name: "sign-in/0003-passkeys",
    sql: `CREATE TABLE passkeys (
  id TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL UNIQUE,
  public_key BLOB NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT NOT NULL,
  rp_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
)`,
  },
];

const Row = Schema.Struct({
  id: PasskeyId,
  credential_id: CredentialId,
  public_key: Schema.Uint8Array,
  counter: Schema.Int,
  transports: Schema.fromJsonString(Schema.Array(Schema.String)),
  rp_id: Schema.String,
  origin: Schema.String,
  user_agent: Schema.String,
  created_at: Schema.DateTimeUtcFromString,
  last_used_at: Schema.NullOr(Schema.DateTimeUtcFromString),
});

const decodeRow = Schema.decodeUnknownSync(Row);

const passkeyOf = (row: unknown): Passkey => {
  const decoded = decodeRow(row);
  return {
    id: decoded.id,
    credentialId: decoded.credential_id,
    publicKey: decoded.public_key,
    counter: decoded.counter,
    transports: decoded.transports,
    relyingParty: { id: decoded.rp_id, origin: decoded.origin },
    userAgent: decoded.user_agent,
    createdAt: decoded.created_at,
    lastUsedAt: Option.fromNullOr(decoded.last_used_at),
  };
};

const columns =
  "id, credential_id, public_key, counter, transports, rp_id, origin, user_agent, created_at, last_used_at";

const iso = DateTime.formatIso;

/** Passkeys in the hub store's `passkeys` table (`docs/specs/hub-store/spec.md`). */
export const layer: Layer.Layer<Passkeys, never, HubStore> = Layer.effect(
  Passkeys,
  Effect.gen(function* () {
    const store = yield* HubStore;
    return Passkeys.of({
      add: (passkey) =>
        store.use((database) => {
          const id = PasskeyId.make(
            Bun.randomUUIDv7("hex", DateTime.toEpochMillis(passkey.createdAt)),
          );
          const { changes } = database
            .query(
              `INSERT INTO passkeys (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL) ON CONFLICT (credential_id) DO NOTHING`,
            )
            .run(
              id,
              passkey.credentialId,
              passkey.publicKey,
              passkey.counter,
              JSON.stringify(passkey.transports),
              passkey.relyingParty.id,
              passkey.relyingParty.origin,
              passkey.userAgent,
              iso(passkey.createdAt),
            );
          return changes === 1
            ? Option.some({ ...passkey, id })
            : Option.none();
        }),
      all: store.use((database) =>
        database.query(`SELECT ${columns} FROM passkeys`).all().map(passkeyOf),
      ),
      any: store.use(
        (database) =>
          database.query("SELECT 1 FROM passkeys LIMIT 1").get() !== null,
      ),
      findByCredentialId: (credentialId) =>
        store.use((database) =>
          Option.map(
            Option.fromNullOr(
              database
                .query(
                  `SELECT ${columns} FROM passkeys WHERE credential_id = ?`,
                )
                .get(credentialId),
            ),
            passkeyOf,
          ),
        ),
      signedIn: (id, counter, at) =>
        store.use(
          (database) =>
            database
              .query(
                "UPDATE passkeys SET counter = MAX(counter, ?), last_used_at = ? WHERE id = ?",
              )
              .run(counter, iso(at), id).changes === 1,
        ),
      remove: (id, passwordConfigured) =>
        store.use((database) =>
          database.transaction(() => {
            const kept =
              database.query("SELECT 1 FROM passkeys WHERE id = ?").get(id) !==
              null;
            if (!kept) return "NoSuchPasskey" as const;
            const leavesAWayIn =
              passwordConfigured ||
              database.query("SELECT 1 FROM owner_password").get() !== null ||
              database
                .query("SELECT 1 FROM passkeys WHERE id != ? LIMIT 1")
                .get(id) !== null;
            if (!leavesAWayIn) return "LastWayIn" as const;
            database.query("DELETE FROM passkeys WHERE id = ?").run(id);
            return "Removed" as const;
          })(),
        ),
    });
  }),
);
