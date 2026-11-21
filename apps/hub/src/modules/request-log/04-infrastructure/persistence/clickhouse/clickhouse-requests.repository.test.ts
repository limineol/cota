import { describe, expect, it } from "@effect/vitest";
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Schema,
  Scope,
} from "effect";
import { TestClock } from "effect/testing";
import * as RecordRequest from "#modules/request-log/02-application/commands/record-request.command.ts";
import { Prices } from "#modules/request-log/02-application/interfaces/prices.ts";
import {
  type Batch,
  RequestsRepository,
} from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";
import * as Harness from "#shared/05-tests/harness.ts";
import * as ClickHouseRequests from "./clickhouse-requests.repository.ts";
import * as ClickHouse from "./client.ts";
import * as ItemMapper from "./mappers/item.mapper.ts";

type Fault = "none" | "refused" | "lost" | "declined";

interface Attempt {
  readonly table: string;
  readonly token: string;
  readonly stored: boolean;
}

const reach = (counted: () => number, count: number) =>
  Effect.gen(function* () {
    const reached = yield* Harness.waitUntil(() => counted() >= count);
    yield* Effect.promise(() => Bun.sleep(2));
    expect(reached && counted() === count, `${counted()} of ${count}`).toBe(
      true,
    );
  });

/**
 * A ClickHouse that keeps inserted rows in memory, skips an insert whose
 * token it has stored, knows of no item, and fails as it is told, insert by
 * insert: one `refused` is not stored, one `lost` is stored but answered
 * with a failure, and one `declined` is not stored and answered with
 * ClickHouse's exception and its code.
 */
const fakeClickHouse = Effect.gen(function* () {
  const ready = yield* Deferred.make<void>();
  const tokens = new Set<string>();
  const state = {
    tables: new Map<string, Array<unknown>>(),
    attempts: [] as Array<Attempt>,
    faults: [] as Array<Fault>,
  };
  const rowsOf = (table: string) => state.tables.get(table) ?? [];
  const clickHouse: ClickHouse.Client = ClickHouse.ClickHouse.of({
    database: "cota",
    command: () => Deferred.await(ready),
    insert: (table, rows, settings = {}) =>
      Effect.gen(function* () {
        const token = settings.insert_deduplication_token ?? "";
        const fault = state.faults.shift() ?? "none";
        const stored =
          fault !== "refused" && fault !== "declined" && !tokens.has(token);
        state.attempts.push({ table, token, stored });
        if (stored) {
          tokens.add(token);
          state.tables.set(table, [...rowsOf(table), ...rows]);
        }
        if (fault === "declined") {
          return yield* new ClickHouse.ClickHouseError({
            status: 500,
            code: "469",
            detail: "Code: 469. DB::Exception: Constraint `marked` is violated",
          });
        }
        if (fault !== "none") {
          return yield* new ClickHouse.ClickHouseError({
            status: 0,
            code: "",
            detail: `the insert was ${fault}`,
          });
        }
      }),
    select: () => Effect.succeed([]),
    stream: () => Effect.die("the repository never streams"),
    upload: () => Effect.die("the repository never uploads"),
    session: () => clickHouse,
    as: () => clickHouse,
  });
  return {
    state,
    rowsOf,
    layer: Layer.succeed(ClickHouse.ClickHouse, clickHouse),
    open: Deferred.succeed(ready, undefined),
    requestsReach: (count: number) =>
      reach(() => rowsOf("requests").length, count),
    attemptsReach: (count: number) => reach(() => state.attempts.length, count),
  };
});

const prices = Layer.succeed(Prices, Prices.of({ of: () => Option.none() }));

const started = (clickHouse: Layer.Layer<ClickHouse.ClickHouse>) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      RecordRequest.layer().pipe(
        Layer.provide(ClickHouseRequests.layer),
        Layer.provide([clickHouse, prices]),
      ),
      scope,
    );
    return {
      recordRequest: Context.get(context, RecordRequest.RecordRequest),
      close: Scope.close(scope, Exit.void),
    };
  });

const turn = (session: string, said: ReadonlyArray<string>) =>
  Harness.requestOf({
    session,
    conversation: Harness.anthropicConversation({
      model: "claude-opus-5-5",
      system: "Be brief.",
      messages: said.map((content, at) => ({
        role: at % 2 === 0 ? "user" : "assistant",
        content,
      })),
    }),
  });

const itemRows = Schema.decodeUnknownSync(Schema.Array(ItemMapper.ItemRow));

const repositoryOver = (clickHouse: Layer.Layer<ClickHouse.ClickHouse>) =>
  RequestsRepository.pipe(
    Effect.provide(ClickHouseRequests.layer.pipe(Layer.provide(clickHouse))),
  );

const batchOf = (requests: ReadonlyArray<Request.Request>): Batch => ({
  items: requests.flatMap((request) =>
    StoredItems.newItems(new Set(), request),
  ),
  requestItems: requests.flatMap((request) =>
    Option.toArray(StoredItems.requestItemsOf(request)),
  ),
  requests: requests.map((request) => ({ request, cost: Option.none() })),
});

describe("the request log's repository over ClickHouse", () => {
  it.effect(
    "inserts a batch's new items, then its request_items, then its requests",
    () =>
      Effect.gen(function* () {
        const fake = yield* fakeClickHouse;
        const { recordRequest, close } = yield* started(fake.layer);
        yield* recordRequest.execute(turn("s", ["hello"]));
        yield* recordRequest.execute(turn("s", ["hello", "hi", "again"]));
        yield* fake.open;
        yield* fake.requestsReach(2);
        yield* close;

        expect(fake.state.attempts.map(({ table }) => table)).toEqual([
          "items",
          "request_items",
          "requests",
        ]);
        expect(
          itemRows(fake.rowsOf("items")).map(({ content }) => content),
        ).toEqual([
          '"Be brief."',
          '{"content":"hello","role":"user"}',
          '{"content":"hi","role":"assistant"}',
          '{"content":"again","role":"user"}',
        ]);
      }),
  );

  it.effect(
    "tries a batch again with the same rows and tokens, so an insert stored before its failure is not stored twice",
    () =>
      Effect.gen(function* () {
        const fake = yield* fakeClickHouse;
        fake.state.faults.push("none", "lost");
        yield* fake.open;
        const { recordRequest, close } = yield* started(fake.layer);
        yield* recordRequest.execute(turn("s", ["hello"]));
        yield* recordRequest.execute(turn("s", ["hello", "hi", "again"]));
        yield* fake.attemptsReach(2);
        yield* TestClock.adjust("1 second");
        yield* fake.requestsReach(2);
        yield* close;

        const [items, requestItems] = fake.state.attempts;
        expect(fake.state.attempts).toEqual([
          { table: "items", token: items?.token, stored: true },
          { table: "request_items", token: requestItems?.token, stored: true },
          { table: "items", token: items?.token, stored: false },
          { table: "request_items", token: requestItems?.token, stored: false },
          {
            table: "requests",
            token: expect.stringMatching(/-requests$/),
            stored: true,
          },
        ]);
        expect([
          fake.rowsOf("items").length,
          fake.rowsOf("request_items").length,
          fake.rowsOf("requests").length,
        ]).toEqual([4, 2, 2]);
      }),
  );

  it.effect(
    "is declined when ClickHouse answers an exception with its code, and fails when it does not answer",
    () =>
      Effect.gen(function* () {
        const fake = yield* fakeClickHouse;
        const repository = yield* repositoryOver(fake.layer);
        const batch = batchOf([turn("s", ["hello"])]);
        fake.state.faults.push("declined", "refused");

        const declined = yield* Effect.flip(repository.store(batch, "one"));
        const failed = yield* Effect.flip(repository.store(batch, "two"));

        expect([declined._tag, failed._tag]).toEqual([
          "RequestsRepositoryDeclined",
          "RequestsRepositoryFailed",
        ]);
        expect(declined.message).toContain("code 469");
      }),
  );

  it.effect(
    "writes a request's request_items row once when its batch is declined at its requests and its requests come again in smaller batches",
    () =>
      Effect.gen(function* () {
        const fake = yield* fakeClickHouse;
        const repository = yield* repositoryOver(fake.layer);
        const sent = [
          turn("s", ["hello"]),
          turn("s", ["hello", "hi", "again"]),
          turn("t", ["hello"]),
        ];
        fake.state.faults.push("none", "none", "declined");

        yield* Effect.flip(repository.store(batchOf(sent), "whole"));
        yield* repository.store(batchOf(sent.slice(0, 2)), "first");
        yield* repository.store(batchOf(sent.slice(2)), "second");

        expect(
          fake.state.attempts.map(({ table, stored }) => [table, stored]),
        ).toEqual([
          ["items", true],
          ["request_items", true],
          ["requests", false],
          ["items", true],
          ["requests", true],
          ["items", true],
          ["requests", true],
        ]);
        expect([
          fake.rowsOf("request_items").length,
          fake.rowsOf("requests").length,
        ]).toEqual([3, 3]);
      }),
  );

  it.effect(
    "holds a request whose counts fit their columns, and not one with a count past them",
    () =>
      Effect.gen(function* () {
        const fake = yield* fakeClickHouse;
        const repository = yield* repositoryOver(fake.layer);

        expect(
          [4_294_967_295, 4_294_967_296].map((requestBytes) =>
            repository.holds({
              request: Harness.requestOf({ requestBytes }),
              cost: Option.none(),
            }),
          ),
        ).toEqual([true, false]);
      }),
  );
});
