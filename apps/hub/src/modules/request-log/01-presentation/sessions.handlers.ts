import { Effect, Option } from "effect";
import type { HttpApiBuilder } from "effect/http-api";
import { ReportSessionTitles } from "#modules/request-log/02-application/commands/report-session-titles.command.ts";
import {
  type ListedSession,
  ListSessions,
} from "#modules/request-log/02-application/queries/list-sessions.query.ts";
import {
  ReadSession,
  type SessionDetail,
} from "#modules/request-log/02-application/queries/read-session.query.ts";
import * as Session from "#modules/request-log/03-domain/session.ts";
import { CurrentCaller } from "#shared/01-presentation/caller.middleware.ts";
import { requestLogProblem } from "#shared/01-presentation/problems.ts";
import { askedOf, toleranceOf } from "./filters.ts";
import { emptyWindowProblem, NoSuchSessionProblem } from "./problems.ts";
import { cutCharactersOf, entryOf } from "./requests.handlers.ts";
import type * as SessionsApi from "./sessions.api.ts";

const sessionRowOf = (session: ListedSession) => ({
  id: session.id,
  startedAt: session.startedAt,
  endedAt: session.endedAt,
  requests: session.requests,
  errors: session.errors,
  pools: session.pools,
  projects: session.projects,
  machines: session.machines,
  clients: session.clients,
  providers: session.providers,
  models: session.models,
  usage: session.usage,
  usageUnreported: session.usageUnreported,
  costUsd: session.cost,
  unpricedRequests: session.unpricedRequests,
  title: Option.getOrNull(
    Option.map(session.title, (title) => ({
      text: title.text,
      source: title.source,
      at: title.at,
      machine: title.source === "reported" ? title.machine : null,
    })),
  ),
  firstPrompt: Option.getOrNull(session.firstPrompt),
});

const detailOf = ({
  session,
  requests,
  requestsCut,
  segments,
  transcript,
}: SessionDetail) => ({
  session: sessionRowOf(session),
  requests: requests.map((request) => ({
    id: request.id,
    startedAt: request.startedAt,
    requestRole: request.requestRole,
    segment: Option.getOrNull(request.segment),
    operation: request.operation,
    purpose: request.purpose,
    model: request.model,
    servedModel: request.servedModel,
    stopReason: request.stopReason,
    outcome: request.outcome,
    upstreamStatus: request.upstreamStatus,
    errorType: request.errorType,
    promptSize: Option.getOrNull(request.promptSize),
    outputTokens: Option.getOrNull(request.outputTokens),
    costUsd: Option.getOrNull(request.cost),
    durationMs: request.durationMs,
    firstByteMs: Option.getOrNull(request.firstByteMs),
    tools: Option.getOrNull(request.tools),
    divertedFrom: Option.getOrNull(request.divertedFrom),
    follows: Option.getOrNull(request.follows),
  })),
  requestsCut,
  segments: segments.map((segment) => {
    const first = segment.requests[0] ?? segment.tip;
    const last = segment.requests.at(-1) ?? segment.tip;
    return {
      index: segment.index,
      startedBy: segment.startedBy,
      firstRequest: first.id,
      lastRequest: last.id,
      tip: segment.tip.id,
      startedAt: first.startedAt,
      endedAt: last.startedAt,
      requests: segment.requests.length,
      promptSize: Option.getOrNull(segment.tip.promptSize),
    };
  }),
  transcript: Option.getOrNull(
    Option.map(transcript, ({ request, protocol, entries }) => ({
      request,
      protocol,
      entries: entries.map(entryOf),
      cutCharacters: cutCharactersOf(entries),
    })),
  ),
});

export const build = (
  handlers: HttpApiBuilder.Handlers.FromGroup<typeof SessionsApi.group>,
) =>
  Effect.gen(function* () {
    const listSessions = yield* ListSessions;
    const reportSessionTitles = yield* ReportSessionTitles;
    const readSession = yield* ReadSession;

    return handlers
      .handle("sessions", ({ query }) =>
        Effect.gen(function* () {
          const page = {
            limit: query.limit ?? Session.paging.defaultLimit,
            offset: query.offset ?? 0,
          };
          const { sessions, total } = yield* listSessions.execute(
            askedOf(query),
            query.sort ?? "recent",
            page,
            Option.map(Option.fromUndefinedOr(query.q), (q) => ({
              query: q,
              tolerance: toleranceOf(query),
            })),
          );
          return {
            sessions: sessions.map((session) => ({
              ...sessionRowOf(session),
              snippet: Option.getOrNull(session.snippet),
            })),
            total,
            ...page,
          };
        }).pipe(
          Effect.catchTags({
            EmptyWindow: emptyWindowProblem,
            RequestLogUnavailable: requestLogProblem,
          }),
        ),
      )
      .handle("session", ({ params }) =>
        Effect.gen(function* () {
          const detail = yield* readSession.execute(params.session);
          if (Option.isNone(detail)) {
            return yield* new NoSuchSessionProblem({
              detail: `The request log has no session ${JSON.stringify(params.session)}.`,
            });
          }
          return detailOf(detail.value);
        }).pipe(Effect.catchTag("RequestLogUnavailable", requestLogProblem)),
      )
      .handle("reportTitles", ({ headers, payload }) =>
        Effect.gen(function* () {
          const caller = yield* CurrentCaller;
          yield* reportSessionTitles.execute({
            titles: payload.titles,
            machine: headers["x-cota-machine"] ?? "",
            reportedBy: caller._tag === "Owner" ? "owner" : caller.hubKey.name,
          });
        }).pipe(Effect.catchTag("RequestLogUnavailable", requestLogProblem)),
      );
  });
