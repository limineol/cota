import { DateTime, Effect, Layer, Option, Schema } from "effect";
import { StoredPasswords } from "#modules/sign-in/02-application/interfaces/stored-passwords.repository.ts";
import { PasswordHash } from "#modules/sign-in/03-domain/owner-password.ts";
import {
  HubStore,
  type Step,
} from "#shared/04-infrastructure/hub-store/hub-store.ts";

export const steps: ReadonlyArray<Step> = [
  {
    name: "sign-in/0002-owner-password",
    sql: `CREATE TABLE owner_password (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  hash TEXT NOT NULL,
  set_at TEXT NOT NULL
)`,
  },
];

const Row = Schema.Struct({
  hash: PasswordHash,
  set_at: Schema.DateTimeUtcFromString,
});

const decodeRow = Schema.decodeUnknownSync(Row);

const iso = DateTime.formatIso;

/** The stored password in the hub store's `owner_password` table, whose one row a constraint keeps one (`docs/specs/hub-store/spec.md`). */
export const layer: Layer.Layer<StoredPasswords, never, HubStore> =
  Layer.effect(
    StoredPasswords,
    Effect.gen(function* () {
      const store = yield* HubStore;
      return StoredPasswords.of({
        read: store.use((database) =>
          Option.map(
            Option.fromNullOr(
              database
                .query("SELECT hash, set_at FROM owner_password WHERE id = 1")
                .get(),
            ),
            (row) => {
              const decoded = decodeRow(row);
              return { hash: decoded.hash, setAt: decoded.set_at };
            },
          ),
        ),
        keepFirst: (stored) =>
          store.use(
            (database) =>
              database
                .query(
                  "INSERT INTO owner_password (id, hash, set_at) VALUES (1, ?, ?) ON CONFLICT (id) DO NOTHING",
                )
                .run(stored.hash, iso(stored.setAt)).changes === 1,
          ),
        replace: (compared, stored) =>
          store.use(
            (database) =>
              database
                .query(
                  "UPDATE owner_password SET hash = ?, set_at = ? WHERE id = 1 AND hash = ?",
                )
                .run(stored.hash, iso(stored.setAt), compared).changes === 1,
          ),
        forget: (passwordConfigured) =>
          store.use((database) =>
            database.transaction(() => {
              const leavesAWayIn =
                passwordConfigured ||
                database.query("SELECT 1 FROM passkeys LIMIT 1").get() !==
                  null ||
                database.query("SELECT 1 FROM owner_password").get() === null;
              if (!leavesAWayIn) return "LastWayIn" as const;
              database.query("DELETE FROM owner_password").run();
              return "Forgotten" as const;
            })(),
          ),
      });
    }),
  );
