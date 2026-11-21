import { Schema } from "effect";

export const Tokens = Schema.Natural;
export type Tokens = typeof Tokens.Type;

export const Usage = Schema.Struct({
  input: Tokens,
  cacheRead: Tokens,
  cacheWriteShort: Tokens,
  cacheWriteLong: Tokens,
  output: Tokens,
});
export type Usage = typeof Usage.Type;

export const Reported = Schema.Struct({
  tokens: Usage,
  reasoning: Tokens,
  reported: Schema.String,
});
export type Reported = typeof Reported.Type;
