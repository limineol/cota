import { DateTime, Effect, Layer, Option, Schema } from "effect";
import { RoutesRepository } from "#modules/routes/02-application/interfaces/routes.repository.ts";
import * as ProjectPattern from "#modules/routes/03-domain/project-pattern.ts";
import {
  RoutedClient,
  type RouteList,
} from "#modules/routes/03-domain/route-list.ts";
import { PoolId } from "#shared/03-domain/ids.ts";
import {
  HubStore,
  type Step,
} from "#shared/04-infrastructure/hub-store/hub-store.ts";

export const steps: ReadonlyArray<Step> = [
  {
    name: "routes/0001-routes",
    sql: `CREATE TABLE route_lists (
  client TEXT PRIMARY KEY,
  default_pool TEXT,
  revision INTEGER NOT NULL,
  changed_at TEXT NOT NULL
);
CREATE TABLE routes (
  client TEXT NOT NULL REFERENCES route_lists (client),
  position INTEGER NOT NULL,
  pattern TEXT NOT NULL,
  pool TEXT NOT NULL,
  PRIMARY KEY (client, position),
  UNIQUE (client, pattern)
)`,
  },
];

const decodeList = Schema.decodeUnknownSync(
  Schema.Struct({
    client: RoutedClient,
    default_pool: Schema.NullOr(PoolId),
    revision: Schema.Int,
    changed_at: Schema.DateTimeUtcFromString,
  }),
);

const decodeRoute = Schema.decodeUnknownSync(
  Schema.Struct({
    client: RoutedClient,
    position: Schema.Int,
    pattern: Schema.String,
    pool: PoolId,
  }),
);

/** The routed clients' lists in the hub store's `route_lists` and `routes` tables (`docs/specs/routes/spec.md`). */
export const layer: Layer.Layer<RoutesRepository, never, HubStore> =
  Layer.effect(
    RoutesRepository,
    Effect.gen(function* () {
      const store = yield* HubStore;
      return RoutesRepository.of({
        stored: store.use((database) => {
          const routes = database
            .query(
              "SELECT client, position, pattern, pool FROM routes ORDER BY client, position",
            )
            .all()
            .map((row) => decodeRoute(row));
          return database
            .query(
              "SELECT client, default_pool, revision, changed_at FROM route_lists",
            )
            .all()
            .map((row): RouteList => {
              const list = decodeList(row);
              return {
                client: list.client,
                routes: routes
                  .filter(({ client }) => client === list.client)
                  .map(({ position, pattern, pool }) => ({
                    position,
                    pattern: Option.getOrThrow(ProjectPattern.parse(pattern)),
                    pool,
                  })),
                defaultPool: Option.fromNullOr(list.default_pool),
                revision: list.revision,
                changedAt: Option.some(list.changed_at),
              };
            });
        }),
        replace: (change, at) =>
          store.use((database) =>
            database.transaction(() => {
              const changedAt = DateTime.formatIso(at);
              const defaultPool = Option.getOrNull(change.defaultPool);
              const written =
                change.from === 0
                  ? database
                      .query(
                        "INSERT INTO route_lists (client, default_pool, revision, changed_at) VALUES (?, ?, 1, ?) ON CONFLICT (client) DO NOTHING",
                      )
                      .run(change.client, defaultPool, changedAt)
                  : database
                      .query(
                        "UPDATE route_lists SET default_pool = ?, revision = revision + 1, changed_at = ? WHERE client = ? AND revision = ?",
                      )
                      .run(defaultPool, changedAt, change.client, change.from);
              if (written.changes === 0) return false;
              database
                .query("DELETE FROM routes WHERE client = ?")
                .run(change.client);
              const insert = database.query(
                "INSERT INTO routes (client, position, pattern, pool) VALUES (?, ?, ?, ?)",
              );
              for (const route of change.routes) {
                insert.run(
                  change.client,
                  route.position,
                  ProjectPattern.textOf(route.pattern),
                  route.pool,
                );
              }
              return true;
            })(),
          ),
      });
    }),
  );
