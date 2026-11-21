import { Schema } from "effect";
import type * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import { Time, timeOf, UInt32, UInt128, Uuid, uint128Of } from "./columns.ts";

/** A row of `items`, as ClickHouse takes and gives it in JSON. */
export const ItemRow = Schema.Struct({
  session: Schema.String,
  digest: UInt128,
  protocol: Schema.String,
  first_seen: Time,
  request_id: Uuid,
  part: Conversation.Part,
  position: UInt32,
  type: Schema.String,
  role: Schema.String,
  content: Schema.String,
  text: Schema.String,
});
export type ItemRow = typeof ItemRow.Type;

export const itemRowOf = (item: StoredItems.StoredItem): ItemRow => ({
  session: item.session,
  digest: uint128Of(item.digest),
  protocol: item.protocol,
  first_seen: timeOf(item.firstSeen),
  request_id: item.requestId,
  part: item.part,
  position: item.position,
  type: item.type,
  role: item.role,
  content: item.content,
  text: item.text,
});
