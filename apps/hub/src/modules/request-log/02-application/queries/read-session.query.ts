import { Context, Effect, Layer, Option } from "effect";
import {
  RequestLogReader,
  type Wanted,
} from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import { SessionTitles } from "#modules/request-log/02-application/interfaces/session-titles.ts";
import { Transcripts } from "#modules/request-log/02-application/interfaces/transcripts.ts";
import * as FirstPrompt from "#modules/request-log/03-domain/first-prompt.ts";
import {
  type RequestRole,
  rolesOf,
} from "#modules/request-log/03-domain/request-role.ts";
import * as Segment from "#modules/request-log/03-domain/segment.ts";
import * as Session from "#modules/request-log/03-domain/session.ts";
import type { StoredProtocol } from "#modules/request-log/03-domain/stored-protocol.ts";
import * as Title from "#modules/request-log/03-domain/title.ts";
import * as Transcript from "#modules/request-log/03-domain/transcript.ts";
import type * as Conversation from "#shared/03-domain/conversation.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";
import type { RequestLogUnavailable } from "#shared/03-domain/request-log.ts";
import type { ListedSession } from "./list-sessions.query.ts";

export interface ListedRequest extends Session.RequestSummary {
  readonly requestRole: RequestRole;
  /** Its segment's index, for a main request. */
  readonly segment: Option.Option<number>;
  /** How many items its `tools` part has; none without a conversation. */
  readonly tools: Option.Option<number>;
}

export interface SessionTranscript {
  readonly request: Request.RequestId;
  readonly protocol: StoredProtocol;
  readonly entries: ReadonlyArray<Transcript.Entry>;
}

export interface SessionDetail {
  readonly session: ListedSession;
  /** The latest of its traffic requests, in the session's order. */
  readonly requests: ReadonlyArray<ListedRequest>;
  readonly requestsCut: number;
  readonly segments: ReadonlyArray<Segment.Segment>;
  /** Of the last segment's tip; none when the session has no main request. */
  readonly transcript: Option.Option<SessionTranscript>;
}

export class ReadSession extends Context.Service<
  ReadSession,
  {
    /** A session with its requests, their roles, its segments and its last segment's transcript; none when no traffic request has it. */
    readonly execute: (
      session: string,
    ) => Effect.Effect<Option.Option<SessionDetail>, RequestLogUnavailable>;
  }
>()("@cota/hub/request-log/ReadSession") {}

/** One `Wanted` per request, with every part asked for it. */
const wantedOf = (
  session: string,
  asked: ReadonlyArray<readonly [Request.RequestId, Conversation.Part]>,
): ReadonlyArray<Wanted> => {
  const parts = new Map<Request.RequestId, Set<Conversation.Part>>();
  for (const [id, part] of asked) {
    parts.set(id, (parts.get(id) ?? new Set()).add(part));
  }
  return [...parts].map(([id, each]) => ({ session, id, parts: [...each] }));
};

export const layer: Layer.Layer<
  ReadSession,
  never,
  RequestLogReader | SessionTitles | Transcripts
> = Layer.effect(
  ReadSession,
  Effect.gen(function* () {
    const reader = yield* RequestLogReader;
    const titles = yield* SessionTitles;
    const transcripts = yield* Transcripts;
    return ReadSession.of({
      execute: Effect.fn("ReadSession.execute")(function* (session: string) {
        const row = yield* reader.session(session);
        if (Option.isNone(row)) return Option.none<SessionDetail>();
        const reported = Option.fromUndefinedOr(
          (yield* titles.latest([session])).get(session),
        );
        const roled = rolesOf(
          (yield* reader.sessionRequests(
            [session],
            Session.read,
            Session.mostListedRequests,
          )).get(session) ?? [],
        );
        const segments = Segment.segmentsOf(roled);
        const { summaries, cut } = yield* reader.summaries(
          session,
          Session.mostListedRequests,
        );
        const tip = Option.map(
          Option.fromUndefinedOr(segments.at(-1)),
          (segment) => segment.tip,
        );
        const firstMain = FirstPrompt.firstMainRequestOf(roled);
        const titleRequests = Option.exists(
          reported,
          ({ title }) => title !== "",
        )
          ? []
          : Title.titleRequestsOf(roled);
        const items = yield* reader.items(
          wantedOf(session, [
            ...Option.toArray(tip).flatMap((request) =>
              Transcript.parts.map((part) => [request.id, part] as const),
            ),
            ...Option.toArray(firstMain).map(
              (request) => [request.id, "input"] as const,
            ),
            ...titleRequests.map((request) => [request.id, "output"] as const),
          ]),
        );
        const roles = new Map(
          roled.map(({ request, requestRole }) => [
            request.id,
            { request, requestRole },
          ]),
        );
        const segmentOf = new Map(
          segments.flatMap(({ index, requests }) =>
            requests.map(({ id }) => [id, index] as const),
          ),
        );
        return Option.some({
          session: {
            ...row.value,
            title: Title.shownOf(
              reported,
              Title.generatedAmong(
                titleRequests,
                (request) => items.get(request.id)?.output ?? [],
              ),
            ),
            firstPrompt: Option.flatMap(firstMain, (request) =>
              FirstPrompt.firstPromptOf(
                request.protocol,
                items.get(request.id)?.input ?? [],
              ),
            ),
          },
          requests: summaries.map((summary): ListedRequest => {
            const read = roles.get(summary.id);
            return {
              ...summary,
              requestRole: read?.requestRole ?? "utility",
              segment: Option.fromUndefinedOr(segmentOf.get(summary.id)),
              tools: Option.flatMap(
                Option.fromUndefinedOr(read?.request.conversation),
                (conversation) =>
                  Option.map(conversation, ({ tools }) => tools),
              ),
            };
          }),
          requestsCut: cut,
          segments,
          transcript: Option.map(tip, (request) => {
            const parts = items.get(request.id);
            return {
              request: request.id,
              protocol: request.protocol,
              entries: transcripts.entriesOf(
                request.protocol,
                {
                  system: parts?.system ?? [],
                  input: parts?.input ?? [],
                  output: parts?.output ?? [],
                },
                Transcript.longest.session,
              ),
            };
          }),
        });
      }),
    });
  }),
);
