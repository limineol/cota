import { DateTime, Effect, Layer, Schema } from "effect";
import { ReportedThrough } from "#modules/request-log/02-application/interfaces/reported-through.ts";
import { ReportedClient } from "#shared/03-domain/client.ts";
import { PoolId } from "#shared/03-domain/ids.ts";
import {
  HubStore,
  type Step,
} from "#shared/04-infrastructure/hub-store/hub-store.ts";

export const steps: ReadonlyArray<Step> = [
  {
    name: "request-log/0001-reported-through",
    sql: `CREATE TABLE reported_through (
  machine TEXT NOT NULL,
  client TEXT NOT NULL,
  pool TEXT NOT NULL,
  through TEXT NOT NULL,
  reported_at TEXT NOT NULL,
  reported_by TEXT NOT NULL,
  PRIMARY KEY (machine, client, pool)
)`,
  },
];

const decodeRow = Schema.decodeUnknownSync(
  Schema.Struct({
    machine: Schema.String,
    client: ReportedClient,
    pool: PoolId,
    through: Schema.DateTimeUtcFromString,
    reportedAt: Schema.DateTimeUtcFromString,
    reportedBy: Schema.String,
  }),
);

/**
 * Reported through in the hub store's `reported_through` table. Its times are
 * ISO 8601 instants in UTC with milliseconds, all of one length from 2020 on,
 * so that the greater text is the later instant.
 */
export const layer: Layer.Layer<ReportedThrough, never, HubStore> =
  Layer.effect(
    ReportedThrough,
    Effect.gen(function* () {
      const store = yield* HubStore;
      return ReportedThrough.of({
        keep: (kept) =>
          store.use((database) => {
            database
              .query(
                `INSERT INTO reported_through (machine, client, pool, through, reported_at, reported_by)
VALUES (?, ?, ?, ?, ?, ?)
ON CONFLICT (machine, client, pool) DO UPDATE SET
  through = MAX(through, excluded.through),
  reported_at = excluded.reported_at,
  reported_by = excluded.reported_by`,
              )
              .run(
                kept.machine,
                kept.client,
                kept.pool,
                DateTime.formatIso(kept.through),
                DateTime.formatIso(kept.reportedAt),
                kept.reportedBy,
              );
          }),
        all: store.use((database) =>
          database
            .query(
              `SELECT machine, client, pool, through, reported_at AS reportedAt, reported_by AS reportedBy
FROM reported_through ORDER BY machine, client, pool`,
            )
            .all()
            .map((row) => decodeRow(row)),
        ),
      });
    }),
  );
