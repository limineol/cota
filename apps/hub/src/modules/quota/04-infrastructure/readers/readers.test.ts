import { expect, layer } from "@effect/vitest";
import {
  DateTime,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Tracer,
} from "effect";
import { HttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import { QuotaReader } from "#modules/quota/02-application/interfaces/quota-reader.ts";
import * as Readers from "#modules/quota/03-domain/readers.ts";
import * as QuotaLogins from "#modules/quota/05-tests/quota-logins.ts";
import * as UsageAnswers from "#modules/quota/05-tests/usage-answers.ts";
import * as FakeProvider from "#shared/05-tests/fake-provider.ts";
import * as Harness from "#shared/05-tests/harness.ts";
import * as QuotaReaders from "./readers.ts";

const unusedPort = (): number => {
  const server = Bun.serve({ port: 0, fetch: () => new Response() });
  const port = server.port ?? 9;
  server.stop(true);
  return port;
};

const failureOf = (provider: "zai" | "opencode-go", baseUrl: string) =>
  Effect.gen(function* () {
    const pool = UsageAnswers.keyedPool(provider, baseUrl);
    const exit = yield* Effect.exit(
      (yield* QuotaReader).read(
        pool,
        Option.getOrThrow(Readers.readerOf(pool, Option.none())),
      ),
    );
    const failure = Option.getOrThrow(Exit.findErrorOption(exit));
    if (failure._tag !== "ReadFailure") throw new Error(failure._tag);
    return {
      kind: failure.kind,
      status: Option.getOrNull(failure.status),
      detail: failure.detail,
      retryAt: Option.getOrNull(failure.retryAt),
    };
  });

const zaiFailure = Effect.gen(function* () {
  const fake = yield* FakeProvider.FakeProvider;
  return yield* failureOf("zai", `${fake.url}/api/coding/paas/v4`);
});

const json = (text: string): FakeProvider.Script => ({
  headers: [["content-type", "application/json"]],
  chunks: [text],
});

layer(Layer.mergeAll(FakeProvider.layer, QuotaReaders.layer()))(
  "the quota readers",
  (it) => {
    it.effect(
      "send one GET to the usage endpoint the pool's base URL gives, with the held key as a bearer token and nothing else of the hub's",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          fake.answer(json(JSON.stringify(UsageAnswers.zaiConstructed)));
          for (const [provider, base, target] of [
            ["zai", "/api/coding/paas/v4", "/api/monitor/usage/quota/limit"],
            ["opencode-go", "/zen/go/v1", "/zen/go/v1/usage"],
          ] as const) {
            fake.forget();
            const pool = UsageAnswers.keyedPool(provider, `${fake.url}${base}`);
            yield* Effect.exit(
              (yield* QuotaReader).read(
                pool,
                Option.getOrThrow(Readers.readerOf(pool, Option.none())),
              ),
            );
            const seen = fake.last();
            const headers = new Map(seen.headers);
            expect({
              method: seen.method,
              target: seen.target,
              body: seen.body.length,
              authorization: headers.get("authorization"),
              accept: headers.get("accept"),
              cookie: headers.get("cookie"),
              traceparent: headers.get("traceparent"),
            }).toEqual({
              method: "GET",
              target,
              body: 0,
              authorization: `Bearer ${UsageAnswers.heldKey}`,
              accept: "application/json",
              cookie: undefined,
              traceparent: undefined,
            });
          }
        }),
    );

    it.effect(
      "fail as each answer's status says, in a sentence naming the provider that holds no key and no body",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          yield* TestClock.setTime(DateTime.toEpochMillis(UsageAnswers.readAt));
          const failures = [];
          for (const script of [
            { status: 401, chunks: [UsageAnswers.heldKey] },
            { status: 429, headers: [["retry-after", "120"]] as const },
            {
              status: 429,
              headers: [
                ["retry-after", "Fri, 13 Nov 2026 10:30:00 GMT"],
              ] as const,
            },
            { status: 429, headers: [["retry-after", "soon"]] as const },
            { status: 503, chunks: ["upstream fell over"] },
            {
              status: 302,
              headers: [["location", `${fake.url}/elsewhere`]] as const,
            },
          ]) {
            fake.answer(script);
            failures.push(yield* zaiFailure);
          }
          expect(failures).toEqual([
            {
              kind: "refused",
              status: 401,
              detail: "Z.ai's usage endpoint answered 401.",
              retryAt: null,
            },
            {
              kind: "rate-limited",
              status: 429,
              detail: "Z.ai's usage endpoint answered 429.",
              retryAt: DateTime.makeUnsafe("2026-11-13T10:02:00Z"),
            },
            {
              kind: "rate-limited",
              status: 429,
              detail: "Z.ai's usage endpoint answered 429.",
              retryAt: DateTime.makeUnsafe("2026-11-13T10:30:00Z"),
            },
            {
              kind: "rate-limited",
              status: 429,
              detail: "Z.ai's usage endpoint answered 429.",
              retryAt: null,
            },
            {
              kind: "failed",
              status: 503,
              detail: "Z.ai's usage endpoint answered 503.",
              retryAt: null,
            },
            {
              kind: "failed",
              status: 302,
              detail: "Z.ai's usage endpoint answered 302.",
              retryAt: null,
            },
          ]);
          expect(fake.seen().map(({ target }) => target)).not.toContain(
            "/elsewhere",
          );
        }),
    );

    it.effect(
      "read a retry-after only as whole seconds or an HTTP date, and never further than 24 hours ahead",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          yield* TestClock.setTime(DateTime.toEpochMillis(UsageAnswers.readAt));
          const retryAts = [];
          for (const value of [
            "3600.5",
            "1.5",
            "-5",
            "86400000000",
            "Thu, 12 Nov 2026 10:00:00 GMT",
            "Sat, 14 Nov 2026 12:00:00 GMT",
            "2026-11-13T11:00:00Z",
          ]) {
            fake.answer({ status: 429, headers: [["retry-after", value]] });
            const { retryAt } = yield* zaiFailure;
            retryAts.push(
              retryAt === null ? null : DateTime.formatIso(retryAt),
            );
          }
          expect(retryAts).toEqual([
            null,
            null,
            null,
            "2026-11-14T10:00:00.000Z",
            "2026-11-12T10:00:00.000Z",
            "2026-11-14T10:00:00.000Z",
            null,
          ]);
        }),
    );

    it.effect(
      "say why an answer cannot be read by the path of the first field that did not decode, never by its value",
      () =>
        Effect.gen(function* () {
          const fake = yield* FakeProvider.FakeProvider;
          const details = [];
          for (const body of [
            "<html>not json</html>",
            "[]",
            "{}",
            JSON.stringify({ data: { limits: [{ type: "T", unit: 3 }] } }),
            JSON.stringify({
              data: {
                limits: [
                  {
                    type: "T",
                    unit: 3,
                    number: 5,
                    percentage: UsageAnswers.heldKey,
                  },
                ],
              },
            }),
            JSON.stringify({
              data: { limits: [{ type: "T", unit: 3, number: 5 }] },
            }),
          ]) {
            fake.answer(json(body));
            details.push((yield* zaiFailure).detail);
          }
          fake.answer(
            json(
              JSON.stringify({
                usage: { weekly: { percent: 1, resetsAt: "Monday" } },
              }),
            ),
          );
          details.push(
            (yield* failureOf("opencode-go", `${fake.url}/zen/go/v1`)).detail,
          );
          expect(details).toEqual([
            "Z.ai's usage answer could not be read: it is not JSON.",
            "Z.ai's usage answer could not be read: it is malformed.",
            "Z.ai's usage answer could not be read: data is missing.",
            "Z.ai's usage answer could not be read: data.limits[0].number is missing.",
            "Z.ai's usage answer could not be read: data.limits[0].percentage is malformed.",
            "Z.ai's usage answer could not be read: data.limits[0] has neither currentValue nor percentage.",
            "OpenCode Go's usage answer could not be read: usage.weekly.resetsAt is malformed.",
          ]);
        }),
    );

    it.effect("fail unreachable when nothing answers at the endpoint", () =>
      Effect.gen(function* () {
        expect(
          yield* failureOf("zai", `http://127.0.0.1:${unusedPort()}/v4`),
        ).toEqual({
          kind: "unreachable",
          status: null,
          detail: "Z.ai's usage endpoint could not be reached.",
          retryAt: null,
        });
      }),
    );
  },
);

layer(FakeProvider.layer)("a ChatGPT read's trace", (it) => {
  it.effect(
    "names the account id in no span attribute, as it names the access token in none, even when the client records headers",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        fake.answer(json(JSON.stringify(UsageAnswers.chatGptConstructed)));
        const spans: Array<Tracer.NativeSpan> = [];
        const tracer = Tracer.make({
          span: (options) => {
            const span = new Tracer.NativeSpan(options);
            spans.push(span);
            return span;
          },
        });
        const login = QuotaLogins.chatGptLogin(
          "codex",
          { access: "access-token-traced-3f1a", refresh: "refresh-traced" },
          UsageAnswers.readAt,
          DateTime.addDuration(UsageAnswers.readAt, Duration.hours(1)),
          "account-id-traced-77c2",
        );
        const pool = UsageAnswers.subscriptionPool("codex", "chatgpt-codex");
        yield* Effect.gen(function* () {
          yield* (yield* QuotaReader).read(pool, {
            name: "chatgpt",
            period: Duration.seconds(120),
            login,
          });
        }).pipe(
          Effect.provide(
            QuotaReaders.layer({
              anthropic: `${fake.url}${Harness.quotaPaths.anthropicUsage}`,
              chatgpt: `${fake.url}${Harness.quotaPaths.chatgptUsage}`,
            }),
          ),
          Effect.provideService(Tracer.Tracer, tracer),
          Effect.provideService(HttpClient.TracerHeaderFilter, () => true),
        );
        const attributes = JSON.stringify(
          spans.flatMap((span) => [...(span._attributes ?? new Map())]),
        );
        expect({
          sent: fake.seen().length,
          traced: attributes.includes("chatgpt-account-id"),
          accountId: attributes.includes("account-id-traced-77c2"),
          accessToken: attributes.includes("access-token-traced-3f1a"),
        }).toEqual({
          sent: 1,
          traced: true,
          accountId: false,
          accessToken: false,
        });
      }),
  );
});
