import { Schema } from "effect";

/**
 * Reading the request log, or keeping a title in it, failed: its store could
 * not be reached or did not answer in time (`unreachable`), it answered with
 * an error (`failed`, with the store's error code when it gave one), or a
 * search with a tolerance was asked before the log's words were gathered
 * (`gathering`).
 */
export class RequestLogUnavailable extends Schema.TaggedError<
  RequestLogUnavailable,
  { readonly brand: unique symbol }
>()("RequestLogUnavailable", {
  reason: Schema.Literals(["unreachable", "failed", "gathering"]),
  code: Schema.String,
}) {}
