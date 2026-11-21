import { DateTime, Schema } from "effect";
import * as Conversation from "#shared/03-domain/conversation.ts";

export const UInt16 = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 65535 }),
);
export const UInt32 = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 4294967295 }),
);
export const Uuid = Schema.String.check(
  Schema.isPattern(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  ),
);
export const Time = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
);
export const UInt128 = Schema.String.check(Schema.isPattern(/^\d{1,39}$/));

export const timeOf = (at: DateTime.Utc): string => DateTime.formatIso(at);

/** A digest's 32 hex digits, read as a big-endian unsigned integer, in decimal. */
export const uint128Of = (digest: Conversation.Digest): string =>
  BigInt(`0x${digest}`).toString();

export const digestOf = (uint128: string): Conversation.Digest =>
  Conversation.Digest.make(BigInt(uint128).toString(16).padStart(32, "0"));
