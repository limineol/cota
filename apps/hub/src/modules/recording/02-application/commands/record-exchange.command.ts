import {
  Cause,
  Context,
  DateTime,
  Deferred,
  Duration,
  Effect,
  Layer,
  Option,
  Schema,
  Stream,
} from "effect";
import * as Copy from "#lib/copy.ts";
import type * as Tee from "#lib/tee.ts";
import { RecordingDirectory } from "#modules/recording/02-application/interfaces/recording-directory.ts";
import type * as ExchangeFile from "#modules/recording/03-domain/exchange-file.ts";
import * as Scrubber from "#modules/recording/03-domain/scrubber/scrubber.ts";
import type { ProtocolName } from "#shared/03-domain/protocol-name.ts";
import type { Outcome, RequestId } from "#shared/03-domain/request.entity.ts";

export type Headers = Readonly<Record<string, string>>;

/** One exchange's request, as the hub saw it. */
export interface Request {
  readonly id: RequestId;
  readonly startedAt: DateTime.Utc;
  readonly protocol: ProtocolName;
  readonly operation: string;
  readonly method: string;
  readonly target: string;
  readonly headers: Headers;
  readonly body: Option.Option<unknown>;
  readonly decodedBody: Option.Option<Uint8Array>;
  readonly requestBytes: number;
}

export interface Head {
  readonly status: number;
  readonly headers: Headers;
  readonly stream: boolean;
}

/** How the request log closed the exchange. */
export interface Settled {
  readonly outcome: Outcome;
  readonly errorType: string;
}

/** The recording of one exchange. Nothing of it reaches the disk before it is scrubbed. */
export interface Recording {
  /** A reader of the response's copy, for the tee. */
  readonly tap: (head: Head) => Tee.Tap;
  /** Records an answer whose body the hub never read: a dropped refusal, or one without a body. */
  readonly unread: (head: Head) => Effect.Effect<void>;
  readonly settled: (settled: Settled) => Effect.Effect<void>;
}

export class RecordExchange extends Context.Service<
  RecordExchange,
  {
    /** Starts recording an exchange, or does nothing when the recorder is off. */
    readonly execute: (
      request: Request,
    ) => Effect.Effect<Option.Option<Recording>>;
  }
>()("@cota/hub/recording/RecordExchange") {}

export const off: Layer.Layer<RecordExchange> = Layer.succeed(
  RecordExchange,
  RecordExchange.of({ execute: () => Effect.succeedNone }),
);

export interface Options {
  /** The most bytes of a request or a response, decoded, that are recorded. */
  readonly limit: number;
  /** The chunks of a response the recorder may fall behind by. */
  readonly capacity: number;
  /** How long, once a response has ended, its recording may take. */
  readonly patience: Duration.Input;
}

export const defaults = {
  limit: 32 * 1024 * 1024,
  capacity: 4096,
  patience: Duration.seconds(15),
} as const;

export class NotRecorded extends Schema.TaggedError<
  NotRecorded,
  { readonly brand: unique symbol }
>()("NotRecorded", { reason: Schema.String }) {}

const strictText = new TextDecoder("utf-8", { fatal: true });

const parseJson = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Json),
);
const asJson = Schema.decodeUnknownOption(Schema.Json);

const bodyOfBytes = (bytes: Uint8Array): ExchangeFile.Body => {
  try {
    const text = strictText.decode(bytes);
    return Option.match(parseJson(text), {
      onNone: () => ({ text }),
      onSome: (json) => ({ json }),
    });
  } catch {
    return { base64: Buffer.from(bytes).toString("base64") };
  }
};

const requestBodyOf = (
  request: Request,
  limit: number,
): Effect.Effect<ExchangeFile.Body | undefined, NotRecorded> =>
  Effect.gen(function* () {
    if (request.requestBytes === 0) return undefined;
    const decoded = request.decodedBody;
    if (Option.isNone(decoded)) {
      return yield* new NotRecorded({
        reason: "the request body could not be decoded",
      });
    }
    if (decoded.value.byteLength > limit) {
      return yield* new NotRecorded({
        reason: `the request body is over the recorder's limit of ${limit} bytes`,
      });
    }
    return Option.match(Option.flatMap(request.body, asJson), {
      onNone: () => bodyOfBytes(decoded.value),
      onSome: (json): ExchangeFile.Body => ({ json }),
    });
  });

const eventsOf = (text: string) =>
  Stream.runCollect(
    Copy.sseEvents(Stream.succeed(new TextEncoder().encode(text))),
  ).pipe(
    Effect.map((events) =>
      events.map((event): ExchangeFile.Event => {
        const data = Option.getOrElse(
          parseJson(event.data),
          (): Schema.Json => event.data,
        );
        return event.event === "message"
          ? { data }
          : { event: event.event, data };
      }),
    ),
    Effect.mapError(
      () => new NotRecorded({ reason: "the event stream could not be parsed" }),
    ),
  );

const responseBodyOf = Effect.fn("RecordExchange.responseBodyOf")(function* (
  head: Head,
  bytes: Uint8Array,
  limit: number,
): Effect.fn.Return<ExchangeFile.Body | undefined, NotRecorded> {
  if (bytes.byteLength === 0) return undefined;
  const decoded = yield* Copy.decodedBody(
    bytes,
    head.headers["content-encoding"],
    limit,
  ).pipe(
    Effect.mapError(
      (error) =>
        new NotRecorded({
          reason:
            error._tag === "OverLimit"
              ? `the response is over the recorder's limit of ${limit} bytes`
              : "the response body could not be decoded",
        }),
    ),
  );
  if (!head.stream) return bodyOfBytes(decoded);
  const text = yield* Effect.try({
    try: () => strictText.decode(decoded),
    catch: () =>
      new NotRecorded({ reason: "the event stream is not UTF-8 text" }),
  });
  return { events: yield* eventsOf(text) };
});

const stamp = (at: DateTime.Utc): string =>
  DateTime.formatIso(at).replace(/[-:]/g, "");

const wordOf = (text: string): string =>
  text.toLowerCase().replace(/[^a-z0-9_-]+/g, "-") || "none";

/** A recorded exchange's file name: its time, protocol, operation and outcome, and the end of its request id. */
export const fileNameOf = (request: Request, outcome: Outcome): string =>
  `${stamp(request.startedAt)}-${request.protocol}-${wordOf(request.operation)}-${outcome}-${wordOf(request.id.slice(-12))}.json`;

const unfinished = (settled: Settled): boolean =>
  settled.outcome === "cancelled" || settled.errorType.startsWith("cota_");

/**
 * Records every exchange with a provider into the recording directory,
 * scrubbed, one to a file. It warns once, as it starts, that it is on.
 */
export const layer = (
  options: Options,
): Layer.Layer<RecordExchange, never, RecordingDirectory> =>
  Layer.effect(
    RecordExchange,
    Effect.gen(function* () {
      const { limit } = options;
      const directory = yield* RecordingDirectory;
      yield* Effect.logWarning(
        `recording every exchange with a provider into ${directory.path}: each is scrubbed, and must still be read before it is committed`,
      );
      const fakes = Scrubber.makeFakes();

      const record = Effect.fn("RecordExchange.record")(function* (
        request: Request,
        head: Head,
        bytes: Option.Option<Uint8Array>,
        settled: Settled,
      ) {
        if (unfinished(settled)) {
          return yield* new NotRecorded({
            reason: "the exchange did not finish",
          });
        }
        const requestBody = yield* requestBodyOf(request, limit);
        const responseBody = Option.isNone(bytes)
          ? undefined
          : yield* responseBodyOf(head, bytes.value, limit);
        const exchange: ExchangeFile.Exchange = {
          request: {
            method: request.method,
            path: request.target,
            headers: request.headers,
            ...(requestBody === undefined ? {} : { body: requestBody }),
          },
          response: {
            status: head.status,
            headers: head.headers,
            ...(responseBody === undefined ? {} : { body: responseBody }),
          },
        };
        const date = DateTime.formatIsoDate(yield* DateTime.now);
        const text = yield* Effect.try({
          try: () =>
            Scrubber.fileText(
              Scrubber.exchangeFileOf(request.protocol, exchange, fakes, date),
            ),
          catch: () => new NotRecorded({ reason: "the scrubber failed" }),
        });
        const name = fileNameOf(request, settled.outcome);
        yield* directory.write(name, text).pipe(
          Effect.mapError(
            ({ detail }) =>
              new NotRecorded({
                reason: `the exchange file could not be written: ${detail}`,
              }),
          ),
        );
        yield* Effect.logInfo("exchange recorded", { file: name });
      });

      const reported = (effect: Effect.Effect<void, NotRecorded>) =>
        effect.pipe(
          Effect.catchTag("NotRecorded", ({ reason }) =>
            Effect.logWarning("exchange not recorded", { reason }),
          ),
          Effect.catchCauseIf(
            (cause) => !Cause.hasInterruptsOnly(cause),
            () =>
              Effect.logWarning("exchange not recorded", {
                reason: "the recorder failed",
              }),
          ),
          Effect.onInterrupt(() =>
            Effect.logWarning("exchange not recorded", {
              reason: "the recording ran out of time",
            }),
          ),
        );

      return RecordExchange.of({
        execute: (request) =>
          Effect.gen(function* () {
            const settled = yield* Deferred.make<Settled>();
            const finish = (head: Head, bytes: Option.Option<Uint8Array>) =>
              Effect.gen(function* () {
                const ended = yield* Deferred.await(settled);
                yield* record(request, head, bytes, ended);
              });
            return Option.some<Recording>({
              tap: (head) => ({
                capacity: options.capacity,
                patience: options.patience,
                read: (copy) =>
                  reported(
                    Effect.gen(function* () {
                      const bytes = yield* Copy.collected(copy, limit).pipe(
                        Effect.mapError(
                          (error) =>
                            new NotRecorded({
                              reason:
                                error._tag === "OverLimit"
                                  ? `the response is over the recorder's limit of ${limit} bytes`
                                  : "the recorder fell behind the response",
                            }),
                        ),
                      );
                      yield* finish(head, Option.some(bytes));
                    }),
                  ),
              }),
              unread: (head) => reported(finish(head, Option.none())),
              settled: (ended) =>
                Deferred.succeed(settled, ended).pipe(Effect.asVoid),
            });
          }),
      });
    }),
  );
