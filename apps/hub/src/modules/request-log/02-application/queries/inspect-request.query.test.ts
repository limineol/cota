import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Layer, Option } from "effect";
import { RequestLogReader } from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import type { PricedRequest } from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import { SessionTitles } from "#modules/request-log/02-application/interfaces/session-titles.ts";
import * as Session from "#modules/request-log/03-domain/session.ts";
import * as Traffic from "#modules/request-log/03-domain/traffic.ts";
import * as RenderedTranscripts from "#modules/request-log/04-infrastructure/transcripts/transcripts.ts";
import * as InMemoryRequestLogReader from "#modules/request-log/05-tests/fakes/in-memory-request-log-reader.ts";
import * as InMemorySessionTitles from "#modules/request-log/05-tests/fakes/in-memory-session-titles.ts";
import * as Sessions from "#modules/request-log/05-tests/sessions.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import * as Harness from "#shared/05-tests/harness.ts";
import * as InspectRequest from "./inspect-request.query.ts";
import * as ListSessions from "./list-sessions.query.ts";
import * as ReadSession from "./read-session.query.ts";
import * as ReadSnippets from "./read-snippets.query.ts";

const start = Date.UTC(2026, 10, 1);

const requestAt = (
  second: number,
  fields: Partial<Harness.RequestFields> = {},
): PricedRequest => ({
  request: Harness.requestOf({
    session: "long",
    startedAt: DateTime.makeUnsafe(start + second * 1000),
    ...fields,
  }),
  cost: Option.none(),
});

const mainSaying = (second: number, prompt: string) =>
  requestAt(second, {
    purpose: "main",
    conversation: Conversation.read(
      Sessions.rulesOf("anthropic-messages"),
      {
        model: "claude-opus-5-5",
        messages: [{ role: "user", content: prompt }],
      },
      [],
    ),
  });

// The oldest of 10,001 traffic requests is a main request with the first
// prompt of all; the 5,000th, the first main request of the latest 10,000.
const oldest = mainSaying(0, "The first prompt of all.");
const firstKept = mainSaying(5_000, "The first prompt kept.");
const listing = requestAt(1, { operation: "models" });
const log = [
  oldest,
  listing,
  ...Array.from({ length: 10_000 }, (_, at) =>
    at + 1 === 5_000 ? firstKept : requestAt(at + 1),
  ),
];

const held = Sessions.heldOf(log);

const queries = Layer.mergeAll(
  InspectRequest.layer,
  ReadSession.layer,
  ListSessions.layer,
).pipe(
  Layer.provide(ReadSnippets.layer),
  Layer.provide([
    Layer.succeed(
      RequestLogReader,
      InMemoryRequestLogReader.make(() => held),
    ),
    Layer.succeed(
      SessionTitles,
      InMemorySessionTitles.make(
        InMemorySessionTitles.InMemorySessionTitles.of({
          reports: [],
          fails: false,
        }),
      ),
    ),
    RenderedTranscripts.layer,
  ]),
);

describe("a session past its latest 10,000 requests", () => {
  it.effect(
    "has its first prompt from the latest 10,000, and the inspector gives no role or segment to a request older than them",
    () =>
      Effect.gen(function* () {
        const inspect = yield* InspectRequest.InspectRequest;
        const readSession = yield* ReadSession.ReadSession;
        const listSessions = yield* ListSessions.ListSessions;
        const roleOf = (request: PricedRequest) =>
          Effect.map(inspect.execute(request.request.id), (found) =>
            Option.map(found, ({ requestRole, segment }) => ({
              requestRole,
              segment,
            })),
          );

        const detail = yield* readSession.execute("long");
        const listed = yield* listSessions.execute(
          {
            from: Option.some(DateTime.makeUnsafe(start)),
            to: Option.some(DateTime.makeUnsafe(start + 86_400_000)),
            filters: Traffic.noFilters,
          },
          "recent",
          { limit: 1, offset: 0 },
          Option.none(),
        );

        expect(Session.mostListedRequests).toBe(10_000);
        expect(
          Option.map(detail, ({ session, requests, requestsCut }) => ({
            firstPrompt: session.firstPrompt,
            requests: requests.length,
            requestsCut,
          })),
        ).toEqual(
          Option.some({
            firstPrompt: Option.some("The first prompt kept."),
            requests: 10_000,
            requestsCut: 1,
          }),
        );
        expect(listed.sessions.map(({ firstPrompt }) => firstPrompt)).toEqual([
          Option.some("The first prompt kept."),
        ]);
        expect([
          yield* roleOf(oldest),
          yield* roleOf(firstKept),
          yield* roleOf(listing),
        ]).toEqual([
          Option.some({ requestRole: Option.none(), segment: Option.none() }),
          Option.some({
            requestRole: Option.some("main"),
            segment: Option.some(0),
          }),
          Option.some({
            requestRole: Option.some("utility"),
            segment: Option.none(),
          }),
        ]);
      }).pipe(Effect.provide(queries)),
    60_000,
  );
});
