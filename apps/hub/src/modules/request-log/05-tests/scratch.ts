import { BunHttpClient } from "@effect/platform-bun";
import { Context, Duration, Effect, Layer, Option, Redacted } from "effect";
import {
  HttpClient,
  HttpClientError,
  type HttpClientRequest,
  UrlParams,
} from "effect/http";
import * as RecordRequest from "#modules/request-log/02-application/commands/record-request.command.ts";
import {
  type Asked,
  Prices,
} from "#modules/request-log/02-application/interfaces/prices.ts";
import {
  type PricedRequest,
  RequestsRepository,
} from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import type * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import * as ClickHouseRequests from "#modules/request-log/04-infrastructure/persistence/clickhouse/clickhouse-requests.repository.ts";
import * as ClickHouse from "#modules/request-log/04-infrastructure/persistence/clickhouse/client.ts";
import * as PriceLists from "#modules/request-log/04-infrastructure/prices/prices.ts";

/**
 * The ClickHouse the request log's tests run against: `compose.dev.yaml`'s, unless
 * `COTA_TEST_CLICKHOUSE_URL`, `_USER` and `_PASSWORD` name another.
 */
export const server = {
  url: process.env.COTA_TEST_CLICKHOUSE_URL ?? "http://127.0.0.1:18123",
  user: process.env.COTA_TEST_CLICKHOUSE_USER ?? "cota",
  password:
    process.env.COTA_TEST_CLICKHOUSE_PASSWORD ?? "throwaway-dev-password",
};

export const connectionTo = (database: string): ClickHouse.Connection => ({
  url: server.url,
  database,
  user: server.user,
  password: Redacted.make(server.password),
});

/**
 * What a request asks of ClickHouse: an insert's query, from its URL, or the
 * query that is its body.
 */
export const queryOf = (request: HttpClientRequest.HttpClientRequest): string =>
  Option.getOrElse(UrlParams.getFirst(request.urlParams, "query"), () =>
    request.body._tag === "Uint8Array"
      ? new TextDecoder().decode(request.body.body)
      : "",
  );

export type Fault =
  /** The request never reaches ClickHouse. */
  | "down"
  /** ClickHouse runs the request, and its answer is lost. */
  | "answerLost";

/**
 * Decides, for each request to ClickHouse, whether it fails, and how; it is
 * asked with the request's query.
 */
export interface Faults {
  readonly sent: Array<string>;
  faultOf: (query: string) => Fault | undefined;
}

export class Scratch extends Context.Service<
  Scratch,
  { readonly database: string; readonly faults: Faults }
>()("@cota/hub/request-log/Scratch") {}

const lost = (
  request: HttpClientRequest.HttpClientRequest,
  description: string,
) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({ request, description }),
  });

const faultyClient = (faults: Faults) =>
  Layer.effect(
    HttpClient.HttpClient,
    Effect.map(HttpClient.HttpClient, (client) =>
      HttpClient.transform(client, (response, request) =>
        Effect.gen(function* () {
          const query = queryOf(request);
          faults.sent.push(query);
          const fault = faults.faultOf(query);
          if (fault === "down") {
            return yield* lost(request, "ClickHouse is down, as the test says");
          }
          const answer = yield* response;
          if (fault === undefined) return answer;
          yield* answer.text;
          return yield* lost(request, "the answer was lost, as the test says");
        }),
      ),
    ),
  ).pipe(Layer.provide(BunHttpClient.layer));

/**
 * A database of its own for a test, dropped after it, and a ClickHouse client
 * of it that fails as the test says.
 */
export const layer: Layer.Layer<Scratch | ClickHouse.ClickHouse> = Layer.unwrap(
  Effect.gen(function* () {
    const database = `cota_test_${Bun.randomUUIDv7("hex").replaceAll("-", "")}`;
    const faults: Faults = { sent: [], faultOf: () => undefined };
    const admin = yield* Layer.build(
      ClickHouse.layer(connectionTo("default")).pipe(
        Layer.provide(BunHttpClient.layer),
      ),
    ).pipe(
      Effect.map((context) => Context.get(context, ClickHouse.ClickHouse)),
    );
    yield* Effect.acquireRelease(
      admin.command(`CREATE DATABASE ${database}`),
      () =>
        Effect.ignore(
          admin.command(`DROP DATABASE IF EXISTS ${database} SYNC`),
        ),
    ).pipe(Effect.orDie);
    return Layer.merge(
      Layer.succeed(Scratch, Scratch.of({ database, faults })),
      ClickHouse.layer(connectionTo(database)).pipe(
        Layer.provide(faultyClient(faults)),
      ),
    );
  }),
);

/** Prices from the shipped list each request's pricing names. */
export const pricedBy = (listOf: (asked: Asked) => string) =>
  Layer.succeed(
    Prices,
    Prices.of({
      of: (asked) =>
        PriceLists.priceOf(
          { prices: Option.some(listOf(asked)), ownPrices: {} },
          asked,
        ),
    }),
  );

/**
 * Writes a request log through `RecordRequest` over the ClickHouse
 * repository, priced from the Anthropic list unless prices are given, and gives what it stored: the requests with the costs it gave
 * them, their items' digests and the sessions' items.
 */
export const written = (
  log: ReadonlyArray<PricedRequest>,
  prices: Layer.Layer<Prices> = pricedBy(() => "anthropic"),
) =>
  Effect.gen(function* () {
    const stored = {
      requests: [] as PricedRequest[],
      requestItems: [] as StoredItems.RequestItems[],
      items: [] as StoredItems.StoredItem[],
    };
    const capturing = Layer.effect(
      RequestsRepository,
      Effect.map(RequestsRepository, (repository) =>
        RequestsRepository.of({
          ...repository,
          store: (batch, token) =>
            Effect.andThen(
              repository.store(batch, token),
              Effect.sync(() => {
                stored.requests.push(...batch.requests);
                stored.requestItems.push(...batch.requestItems);
                stored.items.push(...batch.items);
              }),
            ),
        }),
      ),
    ).pipe(Layer.provide(ClickHouseRequests.layer));
    yield* Effect.gen(function* () {
      const recordRequest = yield* RecordRequest.RecordRequest;
      for (const { request } of log) yield* recordRequest.execute(request);
    }).pipe(
      Effect.provide(
        RecordRequest.layer({
          ...RecordRequest.defaults,
          firstPause: Duration.millis(20),
          longestPause: Duration.millis(200),
        }).pipe(Layer.provide([capturing, prices])),
      ),
    );
    return stored;
  });
