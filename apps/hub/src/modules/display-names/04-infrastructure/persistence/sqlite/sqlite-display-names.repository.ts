import { DateTime, Effect, Layer, Schema } from "effect";
import { DisplayNamesRepository } from "#modules/display-names/02-application/interfaces/display-names.repository.ts";
import { Kind } from "#modules/display-names/03-domain/display-name.ts";
import {
  HubStore,
  type Step,
} from "#shared/04-infrastructure/hub-store/hub-store.ts";

export const steps: ReadonlyArray<Step> = [
  {
    name: "display-names/0001-display-names",
    sql: `CREATE TABLE display_names (
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  set_at TEXT NOT NULL,
  PRIMARY KEY (kind, key)
)`,
  },
];

const decodeRow = Schema.decodeUnknownSync(
  Schema.Struct({ kind: Kind, key: Schema.String, name: Schema.String }),
);

/** Display names in the hub store's `display_names` table (`docs/specs/hub-store/spec.md`). */
export const layer: Layer.Layer<DisplayNamesRepository, never, HubStore> =
  Layer.effect(
    DisplayNamesRepository,
    Effect.gen(function* () {
      const store = yield* HubStore;
      return DisplayNamesRepository.of({
        all: store.use((database) =>
          database
            .query("SELECT kind, key, name FROM display_names")
            .all()
            .map((row) => decodeRow(row)),
        ),
        set: (name, at) =>
          store.use((database) => {
            database
              .query(
                `INSERT INTO display_names (kind, key, name, set_at) VALUES (?, ?, ?, ?)
ON CONFLICT (kind, key) DO UPDATE SET name = excluded.name, set_at = excluded.set_at`,
              )
              .run(name.kind, name.key, name.name, DateTime.formatIso(at));
          }),
        remove: (kind, key) =>
          store.use(
            (database) =>
              database
                .query("DELETE FROM display_names WHERE kind = ? AND key = ?")
                .run(kind, key).changes > 0,
          ),
      });
    }),
  );
