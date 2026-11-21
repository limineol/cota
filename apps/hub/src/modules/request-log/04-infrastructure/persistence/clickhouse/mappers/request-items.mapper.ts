import { Schema } from "effect";
import type * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import * as Request from "#shared/03-domain/request.entity.ts";
import { digestOf, Time, timeOf, UInt128, Uuid, uint128Of } from "./columns.ts";

/** A row of `request_items`, as ClickHouse takes and gives it in JSON. */
export const RequestItemsRow = Schema.Struct({
  request_id: Uuid,
  session: Schema.String,
  started_at: Time,
  system: Schema.Array(UInt128),
  tools: Schema.Array(UInt128),
  input: Schema.Array(UInt128),
  output: Schema.Array(UInt128),
  layout: Schema.String,
  overlay: Schema.String,
  params: Schema.String,
});
export type RequestItemsRow = typeof RequestItemsRow.Type;

export const requestItemsRowOf = (
  items: StoredItems.RequestItems,
): RequestItemsRow => ({
  request_id: items.requestId,
  session: items.session,
  started_at: timeOf(items.startedAt),
  system: items.system.map(uint128Of),
  tools: items.tools.map(uint128Of),
  input: items.input.map(uint128Of),
  output: items.output.map(uint128Of),
  layout: JSON.stringify(items.layout),
  overlay: JSON.stringify(items.overlay),
  params: JSON.stringify(items.params),
});

/** A row of `request_items` as ClickHouse gives it, with its JSON read. */
export const ReadRequestItemsRow = Schema.Struct({
  ...RequestItemsRow.fields,
  request_id: Request.RequestId,
  started_at: Schema.DateTimeUtcFromString,
  layout: Schema.fromJsonString(Schema.Array(Conversation.Placement)),
  overlay: Schema.fromJsonString(Schema.Array(Conversation.Taken)),
  params: Schema.fromJsonString(Schema.JsonObject),
});
export type ReadRequestItemsRow = typeof ReadRequestItemsRow.Type;

export const requestItemsOf = (
  row: ReadRequestItemsRow,
): StoredItems.RequestItems => ({
  requestId: row.request_id,
  session: row.session,
  startedAt: row.started_at,
  system: row.system.map(digestOf),
  tools: row.tools.map(digestOf),
  input: row.input.map(digestOf),
  output: row.output.map(digestOf),
  layout: row.layout,
  overlay: row.overlay,
  params: row.params,
});
