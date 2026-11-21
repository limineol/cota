import {
  Cause,
  Clock,
  type DateTime,
  Duration,
  Effect,
  Exit,
  FiberSet,
  Layer,
  Option,
  Ref,
  Stream,
} from "effect";
import {
  Cookies,
  HttpBody,
  HttpClient,
  type HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
  HttpMethod,
  HttpServerResponse,
} from "effect/http";
import * as Copy from "#lib/copy.ts";
import * as Tee from "#lib/tee.ts";
import * as RecordExchange from "#modules/recording/02-application/commands/record-exchange.command.ts";
import type * as Protocol from "#modules/relay/02-application/interfaces/protocol.ts";
import * as Provider from "#modules/relay/02-application/interfaces/provider.ts";
import type * as ClientRequest from "#modules/relay/03-domain/client-request.ts";
import type * as Credential from "#modules/relay/03-domain/credential.ts";
import * as FinishedRequest from "#modules/relay/03-domain/finished-request.ts";
import type { Limits } from "#modules/relay/03-domain/limits.ts";
import * as Reading from "#modules/relay/03-domain/reading.ts";
import type * as Refusal from "#modules/relay/03-domain/refusal.ts";
import { RecordRequest } from "#modules/request-log/02-application/commands/record-request.command.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";
import * as Shutdown from "#shared/04-infrastructure/shutdown.ts";
import * as Headers from "./headers.ts";

const longestErrorBody = 64 * 1024;
const drainTimeout = Duration.seconds(5);

interface Copied {
  readonly reading: Reading.Reading;
  readonly body: string;
}

const textOf = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

const copyOf = (
  protocol: Protocol.Protocol,
  reader: Option.Option<Protocol.Reader>,
  headers: ClientRequest.Headers,
  status: number,
  stream: boolean,
  limits: Limits,
): Tee.Copy<Copied> => ({
  initial: { reading: Reading.nothingRead, body: "" },
  read: (copy) => {
    const decoded = Copy.decodedStream(copy, headers["content-encoding"]);
    const unread = () => Stream.drain(copy);
    if (stream) {
      return Option.match(reader, {
        onNone: unread,
        onSome: (read) =>
          read(
            Copy.sseEvents(decoded).pipe(
              Stream.map(
                (event): Protocol.Part => ({
                  _tag: "Event",
                  ...event,
                }),
              ),
            ),
          ).pipe(Stream.map((reading) => ({ reading, body: "" }))),
      });
    }
    if (status >= 400) {
      return Stream.fromEffect(Copy.start(decoded, longestErrorBody)).pipe(
        Stream.map((bytes) => {
          const body = textOf(bytes);
          return {
            reading: { ...Reading.nothingRead, error: protocol.error(body) },
            body,
          };
        }),
      );
    }
    return Option.match(reader, {
      onNone: unread,
      onSome: (read) =>
        Stream.fromEffect(
          Copy.collected(decoded, limits.maxReadAnswerBytes),
        ).pipe(
          Stream.flatMap((bytes) =>
            read(
              Stream.succeed<Protocol.Part>({
                _tag: "Body",
                text: textOf(bytes),
              }),
            ),
          ),
          Stream.map((reading) => ({ reading, body: "" })),
        ),
    });
  },
  isTerminal: ({ reading }) => reading.finished,
});

const isTimeout = (error: HttpClientError.HttpClientError): boolean =>
  error.reason._tag === "TransportError" &&
  Cause.isTimeoutError(error.reason.cause);

const released = (response: HttpClientResponse.HttpClientResponse) =>
  Effect.tryPromise(async () => {
    const web = HttpClientResponse.toWeb(response);
    if (Option.isSome(web)) await web.value.body?.cancel();
  }).pipe(Effect.ignore);

const make = Effect.fn("HttpProvider.make")(function* (limits: Limits) {
  const recordRequest = yield* RecordRequest;
  const shutdown = yield* Shutdown.Shutdown;
  const upstream = (yield* HttpClient.HttpClient).pipe(
    HttpClient.timeout(limits.firstByteTimeout),
  );
  const finishers = yield* Shutdown.Finishers;
  const recordExchange = yield* RecordExchange.RecordExchange;

  const exchange = Effect.fn("HttpProvider.exchange")(function* (
    start: FinishedRequest.Start,
    protocol: Protocol.Protocol,
    outgoing: Provider.Outgoing,
    onRefusal: Option.Option<Credential.OnRefusal>,
  ) {
    const recorded = yield* Ref.make(false);
    const owned = yield* Ref.make(false);
    const recording = yield* recordExchange.execute({
      id: start.id,
      startedAt: start.startedAt,
      protocol: start.protocol,
      operation: start.description.operation,
      method: outgoing.method,
      target: start.target,
      headers: start.headers,
      body: start.body,
      decodedBody: start.decodedBody,
      requestBytes: start.requestBytes,
    });
    const recordUnread = (head: RecordExchange.Head) =>
      Option.isSome(recording)
        ? FiberSet.run(finishers, recording.value.unread(head)).pipe(
            Effect.asVoid,
          )
        : Effect.void;
    const annotations = {
      request: start.id,
      pool: start.pool.id,
      operation: start.description.operation,
    };

    const record = Effect.fn("HttpProvider.record")(function* (
      ending: FinishedRequest.Ending,
    ) {
      if (yield* Ref.getAndSet(recorded, true)) return;
      yield* recordRequest.execute(FinishedRequest.of(start, ending));
      if (Option.isSome(recording)) {
        yield* recording.value.settled({
          outcome: ending.outcome,
          errorType: ending.errorType,
        });
      }
      yield* Effect.logInfo("request finished", {
        outcome: ending.outcome,
        status: ending.upstreamStatus,
        errorType: ending.errorType,
        readingComplete: ending.readingComplete,
      }).pipe(Effect.annotateLogs(annotations));
    }, Effect.uninterruptible);

    const interrupted = Effect.gen(function* () {
      if (yield* shutdown.cutting) {
        return {
          outcome: "error" as const,
          errorType: "cota_hub_shutdown",
          errorMessage:
            "The hub was shutting down and cut the request after its grace period.",
        };
      }
      return {
        outcome: "cancelled" as const,
        errorType: "",
        errorMessage: "",
      };
    }).pipe(Effect.withSpan("HttpProvider.interrupted"));

    yield* Effect.addFinalizer((exit) =>
      Effect.gen(function* () {
        if (yield* Ref.get(owned)) return;
        const endedAt = yield* Clock.currentTimeMillis;
        if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
          yield* record(
            FinishedRequest.unanswered(
              start,
              endedAt,
              "error",
              "cota_hub_failed",
              "The hub failed while forwarding the request.",
            ),
          );
          return;
        }
        const cause = yield* interrupted;
        yield* record(
          FinishedRequest.unanswered(
            start,
            endedAt,
            cause.outcome,
            cause.errorType,
            cause.errorMessage,
          ),
        );
      }),
    );

    const request = HttpClientRequest.make(outgoing.method)(outgoing.url, {
      headers: Headers.forwarded(start.headers, outgoing.credential),
      body: HttpMethod.hasBody(outgoing.method)
        ? HttpBody.raw(outgoing.body, {
            contentType: start.headers["content-type"],
            contentLength: outgoing.body.byteLength,
          })
        : HttpBody.empty,
    });

    const answered = yield* upstream
      .execute(request)
      .pipe(
        Effect.provideService(HttpClient.TracerPropagationEnabled, false),
        Effect.result,
      );

    if (answered._tag === "Failure") {
      const endedAt = yield* Clock.currentTimeMillis;
      const error: Provider.NoAnswer = isTimeout(answered.failure)
        ? {
            type: "cota_provider_timeout",
            message: `The provider of pool "${start.pool.id}" sent no answer within ${Duration.format(limits.firstByteTimeout)}. Raise relay.first_byte_timeout in the hub's configuration if it needs longer.`,
          }
        : {
            type: "cota_provider_unreachable",
            message: `The hub could not reach the provider of pool "${start.pool.id}". Check the pool's base_url, and that the provider is up.`,
          };
      yield* Effect.logWarning("provider did not answer", {
        errorType: error.type,
      }).pipe(Effect.annotateLogs(annotations));
      yield* record(
        FinishedRequest.unanswered(
          start,
          endedAt,
          "error",
          error.type,
          error.message,
        ),
      );
      return {
        _tag: "Unanswered",
        request: start.id,
        reason: error,
      } satisfies Provider.Answer;
    }

    const response = answered.success;
    const status = response.status;
    const stream = Headers.isEventStream(
      { status, headers: response.headers },
      start.description.stream,
    );
    const head: RecordExchange.Head = {
      status,
      headers: response.headers,
      stream,
    };
    const answerHeaders = protocol.answerHeaders(response.headers);
    const headers = Headers.answered(response.headers, start.id);
    const rule = protocol.refusal;
    const headRefusal =
      rule._tag === "FromHead"
        ? yield* rule.of({ status, headers: response.headers })
        : Option.none<Refusal.Refusal>();

    const unread = (
      outcome: Request.Outcome,
      refusalReset: Option.Option<DateTime.Utc>,
    ) =>
      Effect.gen(function* () {
        return {
          outcome,
          upstreamStatus: status,
          errorType: "",
          errorMessage: "",
          reading: Reading.nothingRead,
          readingComplete: true,
          answerHeaders,
          stream,
          responseBytes: 0,
          firstByteAt: Option.none(),
          endedAt: yield* Clock.currentTimeMillis,
          errorBody: "",
          refusalReset,
        } satisfies FinishedRequest.Ending;
      });

    if (Option.isSome(headRefusal) && Option.isSome(onRefusal)) {
      yield* onRefusal.value.record(headRefusal.value);
      const divert = yield* onRefusal.value.divert;
      if (Option.isSome(divert)) {
        yield* released(response);
        yield* record(yield* unread("refused", headRefusal.value.reset));
        yield* recordUnread(head);
        return {
          _tag: "Diverted",
          plan: divert.value,
        } satisfies Provider.Diverted;
      }
    }

    if (
      outgoing.method === "HEAD" ||
      HttpServerResponse.omitsBody(HttpServerResponse.empty({ status }))
    ) {
      yield* record(
        yield* unread(
          Option.isSome(headRefusal)
            ? "refused"
            : status >= 400
              ? "error"
              : "ok",
          Option.flatMap(headRefusal, ({ reset }) => reset),
        ),
      );
      yield* recordUnread(head);
      return {
        _tag: "Answered",
        status,
        headers,
        setCookies: Cookies.toSetCookieHeaders(response.cookies),
        body: Option.none(),
      } satisfies Provider.Answer;
    }

    const reader = protocol.reader(start.description);

    const refusalOf = Effect.fn("HttpProvider.refusalOf")(function* (
      body: string,
    ) {
      if (rule._tag === "FromHead") return headRefusal;
      return yield* rule.of({ status, headers: response.headers, body });
    });

    const settle = Effect.fn("HttpProvider.settle")(function* (
      finished: Tee.Finished<Copied>,
    ) {
      const { reading, body } = finished.read;
      const base = {
        upstreamStatus: status,
        reading,
        readingComplete: finished.complete,
        answerHeaders,
        stream,
        responseBytes: finished.bytes,
        firstByteAt: finished.firstByteAt,
        endedAt: finished.endedAt,
        errorBody: body,
        refusalReset: Option.none<DateTime.Utc>(),
      };
      const providerError = Option.getOrElse(reading.error, () => ({
        type: "",
        message: "",
      }));
      const failed = {
        ...base,
        outcome: "error" as const,
        errorType: providerError.type,
        errorMessage: providerError.message,
      };
      switch (finished.end._tag) {
        case "Interrupted": {
          const cause = yield* interrupted;
          return yield* record({ ...base, ...cause });
        }
        case "Failed":
          return yield* record({
            ...failed,
            errorType: failed.errorType || "cota_stream_broken",
            errorMessage:
              failed.errorMessage ||
              "The provider broke the stream before its answer finished.",
          });
        default:
          break;
      }
      const refusal = yield* refusalOf(body);
      if (Option.isSome(refusal)) {
        return yield* record({
          ...failed,
          outcome: "refused",
          refusalReset: refusal.value.reset,
        });
      }
      if (status >= 400 || Option.isSome(reading.error)) {
        return yield* record(failed);
      }
      if (
        stream &&
        Option.isSome(reader) &&
        finished.end._tag === "Ended" &&
        finished.complete &&
        !reading.finished
      ) {
        return yield* record({
          ...failed,
          errorType: "cota_stream_broken",
          errorMessage:
            "The provider ended the stream before its terminal event.",
        });
      }
      return yield* record({
        ...base,
        outcome: "ok",
        errorType: "",
        errorMessage: "",
      });
    });

    const teed = yield* Tee.tee(
      response.stream.pipe(
        Stream.mapError(() => new Provider.ProviderStreamBroken()),
      ),
      copyOf(protocol, reader, response.headers, status, stream, limits),
      settle,
      {
        capacity: limits.copyCapacity,
        drainTimeout,
        finishers,
        ...(Option.isSome(recording) ? { tap: recording.value.tap(head) } : {}),
      },
    );
    yield* Ref.set(owned, true);
    return {
      _tag: "Answered",
      status,
      headers,
      setCookies: Cookies.toSetCookieHeaders(response.cookies),
      body: Option.some(teed),
    } satisfies Provider.Answer;
  });

  return Provider.Provider.of({ exchange });
});

/** The provider over HTTP, giving each request to the request log and the recorder. */
export const layer = (
  limits: Limits,
): Layer.Layer<
  Provider.Provider,
  never,
  | RecordRequest
  | Shutdown.Shutdown
  | Shutdown.Finishers
  | HttpClient.HttpClient
  | RecordExchange.RecordExchange
> => Layer.effect(Provider.Provider, make(limits));
