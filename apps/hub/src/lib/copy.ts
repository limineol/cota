import { Effect, Option, Schema, Stream } from "effect";
import * as Sse from "effect/encoding/Sse";

export class DecodeFailed extends Schema.TaggedError<
  DecodeFailed,
  { readonly brand: unique symbol }
>()("DecodeFailed", { reason: Schema.String }) {}

export class OverLimit extends Schema.TaggedError<
  OverLimit,
  { readonly brand: unique symbol }
>()("OverLimit", { limit: Schema.Int }) {}

export type Coding = "identity" | "gzip" | "deflate" | "brotli" | "zstd";

export const codingOf = (
  contentEncoding: string | undefined,
): Option.Option<Coding> => {
  switch (contentEncoding?.trim().toLowerCase() ?? "") {
    case "":
    case "identity":
      return Option.some("identity");
    case "gzip":
    case "x-gzip":
      return Option.some("gzip");
    case "deflate":
      return Option.some("deflate");
    case "br":
      // Bun's DecompressionStream names brotli "brotli", not the HTTP token "br".
      return Option.some("brotli");
    case "zstd":
      return Option.some("zstd");
    default:
      return Option.none();
  }
};

// DecompressionStream takes chunks backed by an ArrayBuffer, which Bun's
// chunks are; one backed by a SharedArrayBuffer is copied.
const ownBuffer = (chunk: Uint8Array): Uint8Array<ArrayBuffer> =>
  chunk.buffer instanceof ArrayBuffer
    ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    : new Uint8Array(chunk);

export const decompress =
  (coding: Coding) =>
  <E>(
    self: Stream.Stream<Uint8Array, E>,
  ): Stream.Stream<Uint8Array, E | DecodeFailed> =>
    coding === "identity"
      ? self
      : Stream.fromReadableStream({
          evaluate: () =>
            Stream.toReadableStream(Stream.map(self, ownBuffer)).pipeThrough(
              new DecompressionStream(coding),
            ),
          onError: (cause) =>
            new DecodeFailed({
              reason: `cannot decompress ${coding}: ${String(cause)}`,
            }),
        });

export const decodedStream = <E>(
  self: Stream.Stream<Uint8Array, E>,
  contentEncoding: string | undefined,
): Stream.Stream<Uint8Array, E | DecodeFailed> =>
  Option.match(codingOf(contentEncoding), {
    onNone: () =>
      Stream.fail(
        new DecodeFailed({
          reason: `cannot decode content-encoding ${contentEncoding}`,
        }),
      ),
    onSome: (coding) => decompress(coding)(self),
  });

export const collected = Effect.fn("Copy.collected")(function* <E>(
  self: Stream.Stream<Uint8Array, E>,
  limit: number,
): Effect.fn.Return<Uint8Array, E | OverLimit> {
  const chunks: Array<Uint8Array> = [];
  let size = 0;
  yield* Stream.runForEach(self, (chunk) => {
    size += chunk.byteLength;
    if (size > limit) return Effect.fail(new OverLimit({ limit }));
    chunks.push(chunk);
    return Effect.void;
  });
  const whole = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    whole.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return whole;
});

/**
 * Keeps the first `limit` bytes of a stream and reads the rest without
 * keeping it.
 */
export const start = Effect.fn("Copy.start")(function* <E>(
  self: Stream.Stream<Uint8Array, E>,
  limit: number,
): Effect.fn.Return<Uint8Array, E> {
  const whole = new Uint8Array(limit);
  let size = 0;
  yield* Stream.runForEach(self, (chunk) =>
    Effect.sync(() => {
      const kept = chunk.subarray(0, limit - size);
      whole.set(kept, size);
      size += kept.byteLength;
    }),
  );
  return whole.subarray(0, size);
});

export const decodedBody = (
  body: Uint8Array,
  contentEncoding: string | undefined,
  limit: number,
) => collected(decodedStream(Stream.succeed(body), contentEncoding), limit);

export interface SseEvent {
  readonly event: string;
  readonly data: string;
}

export const sseEvents = <E>(
  self: Stream.Stream<Uint8Array, E>,
): Stream.Stream<SseEvent, E | Sse.SseError | Sse.Retry> =>
  self.pipe(
    Stream.decodeText(),
    Stream.pipeThroughChannel(Sse.decode()),
    Stream.map((event) => ({ event: event.event, data: event.data })),
  );
