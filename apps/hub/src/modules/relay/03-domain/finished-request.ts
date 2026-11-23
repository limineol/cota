import { DateTime, Option } from "effect";
import * as Client from "#shared/03-domain/client.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import type {
  HubKeyName,
  LoginFingerprint,
  PoolId,
} from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import type { ProtocolName } from "#shared/03-domain/protocol-name.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";
import type * as ClientRequest from "./client-request.ts";
import type * as Description from "./description.ts";
import * as Reading from "./reading.ts";

/** What the hub knows of a request when it sends it. */
export interface Start {
  readonly id: Request.RequestId;
  readonly startedAt: DateTime.Utc;
  readonly pool: Pool.Pool;
  readonly protocol: ProtocolName;
  readonly hubKey: HubKeyName;
  readonly description: Description.Description;
  readonly conversationRules: Option.Option<Conversation.Rules>;
  readonly headers: ClientRequest.Headers;
  readonly target: string;
  readonly body: Option.Option<unknown>;
  readonly decodedBody: Option.Option<Uint8Array>;
  readonly requestBytes: number;
  readonly loginFingerprint: Option.Option<LoginFingerprint>;
  readonly divertedFrom: Option.Option<PoolId>;
  readonly follows: Option.Option<Request.RequestId>;
}

export interface Ending {
  readonly outcome: Request.Outcome;
  readonly upstreamStatus: number;
  readonly errorType: string;
  readonly errorMessage: string;
  readonly reading: Reading.Reading;
  readonly readingComplete: boolean;
  readonly answerHeaders: Reading.AnswerHeaders;
  readonly stream: boolean;
  readonly responseBytes: number;
  readonly firstByteAt: Option.Option<number>;
  readonly endedAt: number;
  readonly errorBody: string;
  readonly refusalReset: Option.Option<DateTime.Utc>;
}

const longestTag = 200;

const tagOf = (headers: ClientRequest.Headers, name: string): string =>
  (headers[name] ?? "").trim().slice(0, longestTag);

const noAnswerHeaders: Reading.AnswerHeaders = {
  providerRequestId: "",
  servedModel: "",
  rateLimits: {},
};

export const unanswered = (
  start: Start,
  endedAt: number,
  outcome: Request.Outcome,
  errorType: string,
  errorMessage: string,
): Ending => ({
  outcome,
  upstreamStatus: 0,
  errorType,
  errorMessage,
  reading: Reading.nothingRead,
  readingComplete: true,
  answerHeaders: noAnswerHeaders,
  stream: start.description.stream,
  responseBytes: 0,
  firstByteAt: Option.none(),
  endedAt,
  errorBody: "",
  refusalReset: Option.none(),
});

export const of = (start: Start, ending: Ending): Request.ForwardedRequest => {
  const { description, headers } = start;
  const started = DateTime.toEpochMillis(start.startedAt);
  const model = Option.getOrElse(description.model, () => "");
  const servedModel =
    ending.reading.servedModel || ending.answerHeaders.servedModel;
  const userAgent = headers["user-agent"] ?? "";
  const client = Client.of(tagOf(headers, "x-cota-client"), userAgent);
  return {
    id: start.id,
    startedAt: start.startedAt,
    durationMs: Math.max(ending.endedAt - started, 0),
    session: Option.match(description.session, {
      onNone: () => `request:${start.id}`,
      onSome: ({ id }) => id,
    }),
    machine: tagOf(headers, "x-cota-machine"),
    project: tagOf(headers, "x-cota-project"),
    client: client.client,
    clientVersion: client.version,
    pool: start.pool.id,
    provider: start.pool.provider,
    operation: description.operation,
    model,
    outcome: ending.outcome,
    errorType: ending.errorType,
    errorMessage: ending.errorMessage,
    stopReason: ending.reading.stopReason,
    usage: ending.reading.usage,
    providerRequestId: ending.answerHeaders.providerRequestId,
    conversation: Option.flatMap(start.conversationRules, (rules) =>
      Option.flatMap(start.body, (body) =>
        Conversation.read(rules, body, ending.reading.output),
      ),
    ),
    origin: {
      _tag: "forwarded",
      protocol: start.protocol,
      hubKey: start.hubKey,
      firstByteMs: Option.map(ending.firstByteAt, (at) =>
        Math.max(at - started, 0),
      ),
      sessionSource: Option.match(description.session, {
        onNone: () => "",
        onSome: ({ source }) => source,
      }),
      userAgent,
      divertedFrom: start.divertedFrom,
      follows: start.follows,
      loginFingerprint: start.loginFingerprint,
      refusalReset: ending.refusalReset,
      purpose: description.purpose,
      servedModel: servedModel === model ? "" : servedModel,
      stream: ending.stream,
      upstreamStatus: ending.upstreamStatus,
      serviceTier: ending.reading.serviceTier || description.serviceTier,
      rateLimits: ending.answerHeaders.rateLimits,
      clientHeaders: description.headers,
      errorBody: ending.errorBody,
      requestBytes: start.requestBytes,
      responseBytes: ending.responseBytes,
      readingComplete: ending.readingComplete,
    },
  };
};
