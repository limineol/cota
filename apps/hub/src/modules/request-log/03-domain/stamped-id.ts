import { DateTime, Order } from "effect";
import * as Request from "#shared/03-domain/request.entity.ts";

const hex = (bytes: Uint8Array) =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const mostMillis = 2n ** 48n - 1n;

/**
 * A request id made from a text: a UUID version 7 whose 48-bit time is the
 * request's start in milliseconds and whose other 74 bits are the first 74
 * of the SHA-256 of the text, so the same text and start always give the same
 * id (`docs/specs/import/spec.md`, `docs/specs/reported-requests/spec.md`).
 */
export const stampedIdOf = (
  text: string,
  startedAt: DateTime.Utc,
): Request.RequestId => {
  const millis = BigInt(Math.max(0, DateTime.toEpochMillis(startedAt)));
  const digest = new Bun.CryptoHasher("sha256").update(text).digest();
  const first80 = BigInt(`0x${hex(digest.subarray(0, 10))}`);
  const random = first80 >> 6n;
  const value =
    (Order.min(Order.BigInt)(millis, mostMillis) << 80n) |
    (7n << 76n) |
    ((random >> 62n) << 64n) |
    (2n << 62n) |
    (random & (2n ** 62n - 1n));
  const text32 = value.toString(16).padStart(32, "0");
  return Request.RequestId.make(
    `${text32.slice(0, 8)}-${text32.slice(8, 12)}-${text32.slice(12, 16)}-${text32.slice(16, 20)}-${text32.slice(20)}`,
  );
};
