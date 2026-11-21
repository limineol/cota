import { Schema } from "effect";

const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));

export const Limits = Schema.Struct({
  maxBodyBytes: PositiveInt,
  maxDecodedBodyBytes: PositiveInt,
  maxReadAnswerBytes: PositiveInt,
  firstByteTimeout: Schema.Duration,
  copyCapacity: PositiveInt,
});
export type Limits = typeof Limits.Type;
