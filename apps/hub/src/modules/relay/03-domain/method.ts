import { Schema } from "effect";

/** A method the hub relays. */
export const Method = Schema.Literals([
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS",
  "TRACE",
  "QUERY",
]);
export type Method = typeof Method.Type;
