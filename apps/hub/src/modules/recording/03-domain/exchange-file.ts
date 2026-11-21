import { Schema } from "effect";

export const Headers = Schema.Record(Schema.String, Schema.String);

export const Event = Schema.Struct({
  event: Schema.optionalKey(Schema.String),
  data: Schema.Json,
});
export type Event = typeof Event.Type;

export const Body = Schema.Union([
  Schema.Struct({ json: Schema.Json }),
  Schema.Struct({ text: Schema.String }),
  Schema.Struct({ events: Schema.Array(Event) }),
  Schema.Struct({ base64: Schema.String }),
]);
export type Body = typeof Body.Type;

export const Source = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("constructed"),
    from: Schema.Array(Schema.String),
    note: Schema.optionalKey(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("recorded"),
    date: Schema.String,
    client: Schema.String,
    version: Schema.String,
  }),
]);

export const ExchangeFile = Schema.Struct({
  source: Source,
  request: Schema.Struct({
    method: Schema.String,
    path: Schema.String,
    headers: Headers,
    body: Schema.optionalKey(Body),
  }),
  response: Schema.Struct({
    status: Schema.Int,
    headers: Headers,
    body: Schema.optionalKey(Body),
  }),
  expects: Schema.Struct({ logged: Schema.Json }),
});
export type ExchangeFile = typeof ExchangeFile.Type;
export type Source = typeof Source.Type;

/** One request and its response, as the hub saw them or as an exchange file holds them. */
export interface Exchange {
  readonly request: ExchangeFile["request"];
  readonly response: ExchangeFile["response"];
}
