import { expect, layer } from "@effect/vitest";
import { Arbitrary, DateTime, Effect, Layer, Option, Schema } from "effect";
import { RequestLogReader } from "#modules/request-log/02-application/interfaces/request-log-reader.ts";
import type { PricedRequest } from "#modules/request-log/02-application/interfaces/requests.repository.ts";
import { SessionTitles } from "#modules/request-log/02-application/interfaces/session-titles.ts";
import * as ListSessions from "#modules/request-log/02-application/queries/list-sessions.query.ts";
import * as ReadSnippets from "#modules/request-log/02-application/queries/read-snippets.query.ts";
import * as FirstPrompt from "#modules/request-log/03-domain/first-prompt.ts";
import { rolesOf } from "#modules/request-log/03-domain/request-role.ts";
import * as Session from "#modules/request-log/03-domain/session.ts";
import * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import * as Title from "#modules/request-log/03-domain/title.ts";
import * as Traffic from "#modules/request-log/03-domain/traffic.ts";
import * as RenderedTranscripts from "#modules/request-log/04-infrastructure/transcripts/transcripts.ts";
import * as InMemoryRequestLogReader from "#modules/request-log/05-tests/fakes/in-memory-request-log-reader.ts";
import * as InMemorySessionTitles from "#modules/request-log/05-tests/fakes/in-memory-session-titles.ts";
import * as Sessions from "#modules/request-log/05-tests/sessions.ts";
import * as Generated from "#modules/request-log/05-tests/traffic.ts";
import * as Request from "#shared/03-domain/request.entity.ts";

let held: InMemoryRequestLogReader.Held = {
  requests: [],
  requestItems: [],
  items: [],
};
const titles = InMemorySessionTitles.InMemorySessionTitles.of({
  reports: [],
  fails: false,
});
const reader = InMemoryRequestLogReader.make(() => held);

const overHeld = ListSessions.layer.pipe(
  Layer.provide(ReadSnippets.layer),
  Layer.provide([
    Layer.succeed(RequestLogReader, reader),
    Layer.succeed(SessionTitles, InMemorySessionTitles.make(titles)),
    RenderedTranscripts.layer,
  ]),
);

const holding = (
  log: ReadonlyArray<PricedRequest>,
  reports: ReadonlyArray<Title.Report> = [],
) =>
  Effect.sync(() => {
    held = Sessions.heldOf(log);
    titles.reports.splice(0, titles.reports.length, ...reports);
  });

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const day = 24 * 60 * 60 * 1000;

/** Every generated request, in every session. */
const everything: Traffic.Asked = {
  from: Option.some(DateTime.makeUnsafe(Generated.span.from - day)),
  to: Option.some(DateTime.makeUnsafe(Generated.span.to + day)),
  filters: Traffic.noFilters,
};

const asked = Generated.selection.pipe(Arbitrary.map(Generated.askedOf));

const order = Sessions.pick(Session.SessionOrder.literals);

/** Model listings, with ids no generated request log has. */
const modelListings = Generated.requestLog(20).pipe(
  Arbitrary.map((log) =>
    log.map(
      ({ request }): PricedRequest => ({
        request: {
          ...request,
          id: Request.RequestId.make(
            `${request.id.slice(0, 19)}9${request.id.slice(20)}`,
          ),
          operation: "models",
        },
        cost: Option.none(),
      }),
    ),
  ),
);

const listed = (
  asked: Traffic.Asked,
  order: Session.SessionOrder,
  page: Session.Page,
) =>
  Effect.flatMap(ListSessions.ListSessions, (sessions) =>
    sessions.execute(asked, order, page, Option.none()),
  ).pipe(Effect.orDie);

/** A session's requests with their roles, and each request as it was logged. */
const roledOf = (session: string, log: ReadonlyArray<PricedRequest>) =>
  Effect.gen(function* () {
    const requests = yield* reader
      .sessionRequests([session], Session.read, Session.mostListedRequests)
      .pipe(Effect.orDie);
    const logged = new Map(log.map(({ request }) => [request.id, request]));
    return rolesOf(requests.get(session) ?? []).map(
      ({ request, requestRole }) => ({
        requestRole,
        request,
        logged: logged.get(request.id),
      }),
    );
  });

layer(overHeld)("the sessions list over the in-memory reader", (it) => {
  it.effect.prop(
    "T8: a listed session shows its latest report when not empty, else the title of its latest ok title request whose answer reads as one, else none",
    { log: Sessions.sessionLog(60), reports: Sessions.reports },
    ({ log, reports }) =>
      Effect.gen(function* () {
        yield* holding(log, reports);
        const { sessions } = yield* listed(everything, "recent", {
          limit: 200,
          offset: 0,
        });
        for (const session of sessions) {
          const roled = yield* roledOf(session.id, log);
          const generated = roled
            .filter(
              ({ requestRole, request }) =>
                requestRole === "title" && request.outcome === "ok",
            )
            .reverse()
            .flatMap(({ request, logged }) =>
              Option.toArray(
                Option.flatMap(Option.fromUndefinedOr(logged), (each) =>
                  Option.flatMap(each.conversation, ({ output }) =>
                    Title.generatedOf(output),
                  ),
                ),
              ).map((text) => ({
                source: "generated",
                text,
                at: request.startedAt,
              })),
            );
          const expected = Option.match(
            Option.filter(
              Sessions.latestOf(session.id, reports),
              ({ title }) => title !== "",
            ),
            {
              onSome: ({ title, reportedAt, machine }) => ({
                source: "reported",
                text: title,
                at: reportedAt,
                machine,
              }),
              onNone: () => generated[0] ?? null,
            },
          );

          expect(Generated.plain(session.title), session.id).toEqual(
            Generated.plain(expected),
          );
        }
      }),
    { timeout: 30_000 },
  );

  it.effect.prop(
    "T12: a listed session's first prompt is the last user message of its first main request with a conversation, never of a title, subagent or utility request",
    { log: Sessions.sessionLog(60) },
    ({ log }) =>
      Effect.gen(function* () {
        yield* holding(log);
        const { sessions } = yield* listed(everything, "recent", {
          limit: 200,
          offset: 0,
        });
        for (const session of sessions) {
          const roled = yield* roledOf(session.id, log);
          const from = roled.find(
            ({ requestRole, request }) =>
              requestRole === "main" && Option.isSome(request.conversation),
          );
          const expected = Option.flatMap(
            Option.fromUndefinedOr(from?.logged),
            (request) =>
              Option.flatMap(request.conversation, ({ input }) =>
                FirstPrompt.firstPromptOf(
                  StoredItems.protocolOf(request),
                  input,
                ),
              ),
          );

          expect(Option.getOrNull(session.firstPrompt), session.id).toBe(
            Option.getOrNull(expected),
          );
        }
      }),
    { timeout: 30_000 },
  );

  it.effect.prop(
    "H8: for any sort, the sessions list's pages, read by offset from 0 in steps of the limit, are disjoint, keep the order, and together are its total",
    {
      log: Sessions.sessionLog(60),
      asked,
      order,
      limit: int(1, 4),
    },
    ({ log, asked, order, limit }) =>
      Effect.gen(function* () {
        yield* holding(log);
        const whole = yield* listed(asked, order, { limit: 200, offset: 0 });
        const paged: Array<string> = [];
        const totals: Array<number> = [];
        for (let offset = 0; offset < whole.total; offset += limit) {
          const page = yield* listed(asked, order, { limit, offset });
          paged.push(...page.sessions.map(({ id }) => id));
          totals.push(page.total);
        }

        expect(paged).toEqual(whole.sessions.map(({ id }) => id));
        expect(new Set(paged).size).toBe(whole.total);
        expect(totals.every((total) => total === whole.total)).toBe(true);
      }),
    { timeout: 30_000 },
  );

  it.effect.prop(
    "H4: adding model-listing requests to any request log changes no answer of the sessions list",
    {
      log: Sessions.sessionLog(40),
      listings: modelListings,
      asked,
      order,
      limit: int(1, 4),
      offset: int(0, 3),
    },
    ({ log, listings, asked, order, limit, offset }) =>
      Effect.gen(function* () {
        const page = { limit, offset };
        yield* holding(log);
        const without = Generated.plain(yield* listed(asked, order, page));
        yield* holding([...listings, ...log]);

        expect(Generated.plain(yield* listed(asked, order, page))).toEqual(
          without,
        );
      }),
    { timeout: 30_000 },
  );
});
