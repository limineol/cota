import { Option, Schema } from "effect";
import * as Usage from "#shared/03-domain/usage.ts";

export const ProviderError = Schema.Struct({
  type: Schema.String,
  message: Schema.String,
});
export type ProviderError = typeof ProviderError.Type;

export const Reading = Schema.Struct({
  usage: Schema.Option(Usage.Reported),
  output: Schema.Array(Schema.Json),
  stopReason: Schema.String,
  servedModel: Schema.String,
  serviceTier: Schema.String,
  error: Schema.Option(ProviderError),
  finished: Schema.Boolean,
});
export type Reading = typeof Reading.Type;

export const AnswerHeaders = Schema.Struct({
  providerRequestId: Schema.String,
  servedModel: Schema.String,
  rateLimits: Schema.Record(Schema.String, Schema.String),
});
export type AnswerHeaders = typeof AnswerHeaders.Type;

export const nothingRead: Reading = {
  usage: Option.none(),
  output: [],
  stopReason: "",
  servedModel: "",
  serviceTier: "",
  error: Option.none(),
  finished: false,
};
