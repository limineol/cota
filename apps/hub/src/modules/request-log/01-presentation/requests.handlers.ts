import { Effect, Option, Schema } from "effect";
import type { HttpApiBuilder } from "effect/http-api";
import { InspectRequest } from "#modules/request-log/02-application/queries/inspect-request.query.ts";
import { RebuildConversation } from "#modules/request-log/02-application/queries/rebuild-conversation.query.ts";
import * as Session from "#modules/request-log/03-domain/session.ts";
import { originOf } from "#modules/request-log/03-domain/stored-protocol.ts";
import * as Transcript from "#modules/request-log/03-domain/transcript.ts";
import {
  RequestLogProblem,
  requestLogProblem,
} from "#shared/01-presentation/problems.ts";
import { RequestId } from "#shared/03-domain/request.entity.ts";
import type * as Usage from "#shared/03-domain/usage.ts";
import { NoConversationProblem, NoSuchRequestProblem } from "./problems.ts";
import type * as RequestsApi from "./requests.api.ts";

/** An entry as the API gives it. */
export const entryOf = (entry: Transcript.Entry) => {
  const placed = { item: entry.item, part: entry.part };
  switch (entry.kind) {
    case "message":
      return {
        kind: entry.kind,
        ...placed,
        role: entry.role,
        parts: entry.parts.map((part) =>
          part.type === "image"
            ? {
                type: part.type,
                mediaType: Option.getOrNull(part.mediaType),
                bytes: Option.getOrNull(part.bytes),
              }
            : part,
        ),
      };
    case "reasoning":
      return {
        kind: entry.kind,
        ...placed,
        text: Option.getOrNull(entry.text),
        hidden: Option.isNone(entry.text),
        cut: entry.cut,
      };
    case "tool-call":
      return {
        kind: entry.kind,
        ...placed,
        callId: Option.getOrNull(entry.callId),
        name: entry.name,
        input: entry.input,
        cut: entry.cut,
      };
    case "tool-result":
      return {
        kind: entry.kind,
        ...placed,
        callId: Option.getOrNull(entry.callId),
        name: Option.getOrNull(entry.name),
        output: entry.output,
        error: entry.error,
        cut: entry.cut,
      };
    case "other":
      return { kind: entry.kind, ...placed, json: entry.json, cut: entry.cut };
  }
};

/** Every character the entries left out. */
export const cutCharactersOf = (entries: ReadonlyArray<Transcript.Entry>) =>
  entries.reduce((sum, entry) => sum + Transcript.cutOf(entry), 0);

const decodeId = Schema.decodeUnknownOption(RequestId);

const decodeUsage = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Json),
);

const noSuchRequest = (id: string) =>
  Effect.fail(
    new NoSuchRequestProblem({
      detail: `The request log has no request ${JSON.stringify(id)}.`,
    }),
  );

export const build = (
  handlers: HttpApiBuilder.Handlers.FromGroup<typeof RequestsApi.group>,
) =>
  Effect.gen(function* () {
    const inspectRequest = yield* InspectRequest;
    const rebuildConversation = yield* RebuildConversation;

    const inspected = Effect.fn("RequestsHandlers.inspected")(function* (
      id: string,
    ) {
      const decoded = decodeId(id);
      if (Option.isNone(decoded)) return yield* noSuchRequest(id);
      const found = yield* inspectRequest.execute(decoded.value);
      if (Option.isNone(found)) return yield* noSuchRequest(id);
      return found.value;
    });

    return handlers
      .handle("request", ({ params }) =>
        Effect.gen(function* () {
          const found = yield* inspected(params.id);
          const { request, cost } = found;
          const tokens = Option.map(request.usage, (usage) => usage.tokens);
          const count = (of: (usage: Usage.Usage) => number) =>
            Option.match(tokens, { onNone: () => 0, onSome: of });
          const entries = Option.getOrElse(found.entries, () => []);
          const partOf = (part: Transcript.TranscriptPart) =>
            Option.getOrNull(
              Option.map(found.entries, (all) =>
                all.filter((entry) => entry.part === part).map(entryOf),
              ),
            );
          return {
            request: {
              id: request.id,
              startedAt: request.startedAt,
              firstByteMs: Option.getOrNull(request.firstByteMs),
              durationMs: request.durationMs,
              session: request.session,
              sessionSource: request.sessionSource,
              machine: request.machine,
              project: request.project,
              client: request.client,
              clientVersion: request.clientVersion,
              userAgent: request.userAgent,
              hubKey: request.hubKey,
              pool: request.pool,
              divertedFrom: Option.getOrNull(request.divertedFrom),
              follows: Option.getOrNull(request.follows),
              loginFingerprint: Option.getOrNull(request.loginFingerprint),
              refusalReset: Option.getOrNull(request.refusalReset),
              provider: request.provider,
              protocol: request.protocol,
              origin: originOf(request.protocol),
              operation: request.operation,
              purpose: request.purpose,
              model: request.model,
              servedModel: request.servedModel,
              stream: request.stream,
              outcome: request.outcome,
              upstreamStatus: request.upstreamStatus,
              errorType: request.errorType,
              errorMessage: request.errorMessage,
              stopReason: request.stopReason,
              usageReported: Option.isSome(request.usage),
              inputTokens: count(({ input }) => input),
              cacheReadTokens: count(({ cacheRead }) => cacheRead),
              cacheWriteShortTokens: count(
                ({ cacheWriteShort }) => cacheWriteShort,
              ),
              cacheWriteLongTokens: count(
                ({ cacheWriteLong }) => cacheWriteLong,
              ),
              outputTokens: count(({ output }) => output),
              reasoningTokens: Option.match(request.usage, {
                onNone: () => 0,
                onSome: ({ reasoning }) => reasoning,
              }),
              serviceTier: request.serviceTier,
              costUsd: Option.getOrNull(cost),
              providerRequestId: request.providerRequestId,
              rateLimits: request.rateLimits,
              clientHeaders: request.clientHeaders,
              usage: Option.getOrNull(
                Option.flatMap(request.usage, ({ reported }) =>
                  decodeUsage(reported),
                ),
              ),
              errorBody: request.errorBody,
              requestBytes: request.requestBytes,
              responseBytes: request.responseBytes,
              readingComplete: request.readingComplete,
              promptSize: Option.getOrNull(Session.promptSizeOf(request.usage)),
            },
            requestRole: Option.getOrNull(found.requestRole),
            segment: Option.getOrNull(found.segment),
            params: Option.getOrNull(found.params),
            tools: Option.getOrNull(
              Option.map(found.tools, (tools) =>
                tools.map(({ name, description }) => ({
                  name: Option.getOrNull(name),
                  description: Option.getOrNull(description),
                })),
              ),
            ),
            system: partOf("system"),
            input: partOf("input"),
            output: partOf("output"),
            cutCharacters: cutCharactersOf(entries),
            followedBy: Option.getOrNull(found.followedBy),
          };
        }).pipe(Effect.catchTag("RequestLogUnavailable", requestLogProblem)),
      )
      .handle("body", ({ params }) =>
        Effect.gen(function* () {
          const decoded = decodeId(params.id);
          if (Option.isNone(decoded)) return yield* noSuchRequest(params.id);
          const rebuilt = yield* rebuildConversation.execute(decoded.value);
          if (Option.isSome(rebuilt)) return rebuilt.value;
          yield* inspected(params.id);
          return yield* new NoConversationProblem({
            detail: `The request log kept no body for request ${params.id}: its operation carries no conversation, or its body could not be read.`,
          });
        }).pipe(
          Effect.catchTags({
            RequestLogUnavailable: requestLogProblem,
            RequestsRepositoryFailed: (failed) =>
              Effect.logWarning("rebuilding a body failed", failed.detail).pipe(
                Effect.andThen(
                  Effect.fail(
                    new RequestLogProblem({
                      detail:
                        "ClickHouse could not be reached, or failed the query.",
                    }),
                  ),
                ),
              ),
          }),
        ),
      );
  });
