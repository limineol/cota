import { DateTime, Effect, Layer, Option, Schema } from "effect";
import {
  type Asked,
  type Batch,
  type HeldParts,
  type PricedRequest,
  RequestsRepository,
  RequestsRepositoryDeclined,
  RequestsRepositoryFailed,
  type StoredConversation,
} from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";
import * as ClickHouse from "./client.ts";
import { Param } from "./client.ts";
import { digestOf, UInt128 } from "./mappers/columns.ts";
import * as ItemMapper from "./mappers/item.mapper.ts";
import * as RequestMapper from "./mappers/request.mapper.ts";
import * as RequestItemsMapper from "./mappers/request-items.mapper.ts";
import * as Tables from "./schema.ts";

const KnownRow = Schema.Struct({ session: Schema.String, digest: UInt128 });

const Content = Schema.Struct({ digest: UInt128, content: Schema.String });

const Id = Schema.Struct({ id: Schema.String });

const instant = (name: string) =>
  `fromUnixTimestamp64Milli({${name}:Int64}, 'UTC')`;

const millis = (at: DateTime.Utc) => Param.integer(DateTime.toEpochMillis(at));

const rowOf = ({ request, cost }: PricedRequest) =>
  RequestMapper.requestRowOf({ request: StoredItems.storedOf(request), cost });

const insertsOf = (batch: Batch) => [
  { table: "items", rows: batch.items.map(ItemMapper.itemRowOf) },
  {
    table: "request_items",
    rows: batch.requestItems.map(RequestItemsMapper.requestItemsRowOf),
  },
  {
    table: "requests",
    rows: batch.requests.map(rowOf),
  },
];

const isHeld = Schema.is(RequestMapper.RequestRow);

const failed = (error: ClickHouse.ClickHouseError) =>
  new RequestsRepositoryFailed({ detail: error.message });

const failedOrDeclined = (error: ClickHouse.ClickHouseError) =>
  error.code === ""
    ? failed(error)
    : new RequestsRepositoryDeclined({
        detail: error.message,
        code: error.code,
      });

/** The request log's repository over ClickHouse's `items`, `request_items` and `requests`. */
export const layer: Layer.Layer<
  RequestsRepository,
  never,
  ClickHouse.ClickHouse
> = Layer.effect(
  RequestsRepository,
  Effect.gen(function* () {
    const clickHouse = yield* ClickHouse.ClickHouse;

    const unfinished = new Set<Request.RequestId>();

    const store = Effect.fn("ClickHouseRequests.store")(function* (
      batch: Batch,
      token: string,
    ) {
      const requestItems = batch.requestItems.filter(
        ({ requestId }) => !unfinished.has(requestId),
      );
      const written: Array<Request.RequestId> = [];
      for (const { table, rows } of insertsOf({ ...batch, requestItems })) {
        if (rows.length === 0) continue;
        const inserted = yield* Effect.result(
          clickHouse.insert(table, rows, {
            insert_deduplication_token: [token, table].join("-"),
          }),
        );
        if (inserted._tag === "Failure") {
          for (const id of written) unfinished.add(id);
          return yield* failedOrDeclined(inserted.failure);
        }
        if (table === "request_items") {
          written.push(...requestItems.map(({ requestId }) => requestId));
        }
      }
      for (const { request } of batch.requests) unfinished.delete(request.id);
    });

    const known = Effect.fn("ClickHouseRequests.known")(function* (
      sessions: ReadonlyArray<string>,
    ) {
      const rows = yield* clickHouse.select(
        "SELECT session, digest FROM items WHERE session IN {sessions:Array(String)}",
        KnownRow,
        { sessions: Param.strings(sessions) },
      );
      return rows.map(({ session, digest }) => ({
        session,
        digest: digestOf(digest),
      }));
    }, Effect.mapError(failed));

    const held = Effect.fn("ClickHouseRequests.held")(function* (asked: Asked) {
      const ids = asked.requests.map(({ id }) => id);
      if (ids.length === 0) {
        return {
          requests: new Set<Request.RequestId>(),
          requestItems: new Set<Request.RequestId>(),
        };
      }
      const requests = yield* clickHouse.select(
        `SELECT DISTINCT toString(id) AS id FROM requests
         WHERE started_at >= ${instant("from")} AND started_at <= ${instant("to")}
           AND id IN {ids:Array(UUID)}`,
        Id,
        {
          from: millis(asked.from),
          to: millis(asked.to),
          ids: Param.strings(ids),
        },
      );
      const requestItems = yield* clickHouse.select(
        `SELECT DISTINCT toString(request_id) AS id, session FROM request_items
         WHERE session IN {sessions:Array(String)} AND request_id IN {ids:Array(UUID)}`,
        Schema.Struct({ id: Schema.String, session: Schema.String }),
        {
          sessions: Param.strings([
            ...new Set(asked.requests.map(({ session }) => session)),
          ]),
          ids: Param.strings(ids),
        },
      );
      const heldIds = new Set(requests.map(({ id }) => id));
      return {
        requests: new Set(ids.filter((id) => heldIds.has(id))),
        requestItems: new Set(
          asked.requests
            .filter((each) =>
              requestItems.some(
                ({ id, session }) => id === each.id && session === each.session,
              ),
            )
            .map(({ id }) => id),
        ),
      };
    }, Effect.mapError(failed));

    const partsOf = Effect.fn("ClickHouseRequests.partsOf")(function* (
      id: Request.RequestId,
      session: string,
      startedAt: DateTime.Utc,
    ) {
      const params = {
        id: Param.uuid(id),
        session: Param.string(session),
        at: millis(startedAt),
      };
      const rows = yield* clickHouse.select(
        `SELECT toString(id) AS id FROM requests
         WHERE started_at = ${instant("at")} AND id = {id:UUID} AND session = {session:String}
         LIMIT 1`,
        Id,
        params,
      );
      if (rows.length === 0) return Option.none<HeldParts>();
      const [row] = yield* clickHouse.select(
        `SELECT request_id, session, started_at, system, tools, input, output, layout, overlay, params
         FROM request_items
         WHERE session = {session:String} AND started_at = ${instant("at")} AND request_id = {id:UUID}
         LIMIT 1`,
        RequestItemsMapper.ReadRequestItemsRow,
        params,
      );
      if (row === undefined) return Option.none<HeldParts>();
      const requestItems = RequestItemsMapper.requestItemsOf(row);
      const contents = yield* clickHouse.select(
        `SELECT digest, any(content) AS content FROM items
         WHERE session = {session:String}
           AND digest IN (SELECT arrayJoin(output) FROM request_items
                          WHERE session = {session:String} AND started_at = ${instant("at")} AND request_id = {id:UUID})
         GROUP BY digest`,
        Content,
        params,
      );
      const byDigest = new Map(
        contents.map(({ digest, content }) => [digestOf(digest), content]),
      );
      const output: Array<string> = [];
      for (const digest of requestItems.output) {
        const content = byDigest.get(digest);
        if (content === undefined) return Option.none<HeldParts>();
        output.push(content);
      }
      return Option.some({ requestItems, output });
    }, Effect.mapError(failed));

    const conversationOf = Effect.fn("ClickHouseRequests.conversationOf")(
      function* (id: Request.RequestId) {
        const [row] = yield* clickHouse.select(
          `WITH (SELECT any(session) FROM requests WHERE id = {id:UUID}) AS found_session
           SELECT request_id, session, started_at, system, tools, input, output, layout, overlay, params
           FROM request_items WHERE session = found_session AND request_id = {id:UUID} LIMIT 1`,
          RequestItemsMapper.ReadRequestItemsRow,
          { id: Param.uuid(id) },
        );
        if (row === undefined) return Option.none<StoredConversation>();
        const contents = yield* clickHouse.select(
          `WITH (SELECT any(session) FROM requests WHERE id = {id:UUID}) AS found_session
           SELECT digest, any(content) AS content FROM items
           WHERE session = found_session
             AND digest IN (SELECT arrayJoin(arrayConcat(system, tools, input)) FROM request_items WHERE session = found_session AND request_id = {id:UUID})
           GROUP BY digest`,
          Content,
          { id: Param.uuid(id) },
        );
        return Option.some({
          requestItems: RequestItemsMapper.requestItemsOf(row),
          contents: new Map(
            contents.map(({ digest, content }) => [digestOf(digest), content]),
          ),
        });
      },
      Effect.mapError(failed),
    );

    return RequestsRepository.of({
      prepare: Tables.prepare().pipe(
        Effect.provideService(ClickHouse.ClickHouse, clickHouse),
        Effect.mapError(failed),
      ),
      holds: (request) => isHeld(rowOf(request)),
      store,
      known,
      held,
      partsOf,
      conversationOf,
    });
  }),
);
