import { fileURLToPath } from "node:url";
import { expect, layer } from "@effect/vitest";
import {
  Arbitrary,
  DateTime,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
} from "effect";
import { TestClock } from "effect/testing";
import { QuotaReader } from "#modules/quota/02-application/interfaces/quota-reader.ts";
import { TokenEndpoints } from "#modules/quota/02-application/interfaces/token-endpoints.ts";
import type * as QuotaLogin from "#modules/quota/03-domain/quota-login.ts";
import * as Readers from "#modules/quota/03-domain/readers.ts";
import * as TokenEndpointsOverHttp from "#modules/quota/04-infrastructure/token-endpoints/token-endpoints.ts";
import * as QuotaLog from "#modules/quota/05-tests/quota-log.ts";
import * as QuotaLogins from "#modules/quota/05-tests/quota-logins.ts";
import * as UsageAnswers from "#modules/quota/05-tests/usage-answers.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import * as FakeProvider from "#shared/05-tests/fake-provider.ts";
import * as Harness from "#shared/05-tests/harness.ts";
import * as QuotaReaders from "./readers.ts";

const hubPackage: { readonly version: string } = await Bun.file(
  fileURLToPath(new URL("../../../../../package.json", import.meta.url)),
).json();

const at = (iso: string) => DateTime.makeUnsafe(iso);

const tokens = { access: "quota-access-3a9e", refresh: "quota-refresh-3a9e" };
const claudeLogin = QuotaLogins.claudeLogin(
  "claude",
  tokens,
  at("2026-11-13T09:00:00Z"),
  at("2026-11-13T18:00:00Z"),
);
const chatGptLogin = QuotaLogins.chatGptLogin(
  "codex",
  tokens,
  at("2026-11-13T09:00:00Z"),
  at("2026-11-13T18:00:00Z"),
);

/** A pool of the reader's provider under the fake provider's URL, as the readers read it: a keyed pool with its held key, or a subscription pool with its quota login. */
const poolFor = (
  provider: "zai" | "opencode-go" | "anthropic" | "chatgpt",
  url: string,
): {
  readonly pool: Pool.Pool;
  readonly login: Option.Option<QuotaLogin.QuotaLogin>;
} => {
  switch (provider) {
    case "anthropic":
      return {
        pool: UsageAnswers.subscriptionPool(
          "claude",
          "anthropic-messages",
          `${url}/claude`,
        ),
        login: Option.some(claudeLogin),
      };
    case "chatgpt":
      return {
        pool: UsageAnswers.subscriptionPool(
          "codex",
          "chatgpt-codex",
          `${url}/codex`,
        ),
        login: Option.some(chatGptLogin),
      };
    default:
      return {
        pool: UsageAnswers.keyedPool(provider, url),
        login: Option.none(),
      };
  }
};

/** A reader of the quota readers spec, its pool's base URL under the fake provider, its fixture and the windows the spec says it gives. */
const readers = [
  {
    provider: "zai",
    base: "/api/coding/paas/v4",
    target: "/api/monitor/usage/quota/limit",
    fixture: UsageAnswers.zaiConstructed,
    reading: {
      plan: Option.some("Pro"),
      windows: [
        {
          lengthMs: 5 * 3_600_000,
          scope: Option.none(),
          used: 33.300000000000004,
          span: {
            start: at("2026-11-13T08:00:00Z"),
            reset: at("2026-11-13T13:00:00Z"),
          },
        },
        {
          lengthMs: 7 * 86_400_000,
          scope: Option.none(),
          used: 12,
          span: {
            start: at("2026-11-10T00:00:00Z"),
            reset: at("2026-11-17T00:00:00Z"),
          },
        },
        {
          lengthMs: 30 * 86_400_000,
          scope: Option.some("TIME_LIMIT"),
          used: 0,
          span: undefined,
        },
      ],
    },
  },
  {
    provider: "opencode-go",
    base: "/zen/go/v1",
    target: "/zen/go/v1/usage",
    fixture: UsageAnswers.openCodeGoConstructed,
    reading: {
      plan: Option.none(),
      windows: [
        {
          lengthMs: 5 * 3_600_000,
          scope: Option.none(),
          used: 41.5,
          span: {
            start: at("2026-11-13T07:30:00Z"),
            reset: at("2026-11-13T12:30:00Z"),
          },
        },
        {
          lengthMs: 7 * 86_400_000,
          scope: Option.none(),
          used: 18,
          span: {
            start: at("2026-11-09T00:00:00Z"),
            reset: at("2026-11-16T00:00:00Z"),
          },
        },
        {
          lengthMs: 30 * 86_400_000,
          scope: Option.none(),
          used: 7,
          span: undefined,
        },
      ],
    },
  },
  {
    provider: "anthropic",
    base: "",
    target: Harness.quotaPaths.anthropicUsage,
    fixture: UsageAnswers.anthropicConstructed,
    reading: {
      plan: Option.some("Max 20x"),
      windows: [
        {
          lengthMs: 5 * 3_600_000,
          scope: Option.none(),
          used: 41,
          span: {
            start: at("2026-11-13T08:00:00Z"),
            reset: at("2026-11-13T13:00:00Z"),
          },
        },
        {
          lengthMs: 7 * 86_400_000,
          scope: Option.none(),
          used: 12.5,
          span: {
            start: at("2026-11-10T00:00:00Z"),
            reset: at("2026-11-17T00:00:00Z"),
          },
        },
        {
          lengthMs: 7 * 86_400_000,
          scope: Option.some("Claude Opus"),
          used: 30,
          span: {
            start: at("2026-11-10T00:00:00Z"),
            reset: at("2026-11-17T00:00:00Z"),
          },
        },
      ],
    },
  },
  {
    provider: "chatgpt",
    base: "",
    target: Harness.quotaPaths.chatgptUsage,
    fixture: UsageAnswers.chatGptConstructed,
    reading: {
      plan: Option.some("Pro 20x"),
      windows: [
        {
          lengthMs: 5 * 3_600_000,
          scope: Option.none(),
          used: 22,
          span: {
            start: at("2026-11-13T08:00:00Z"),
            reset: at("2026-11-13T13:00:00Z"),
          },
        },
        {
          lengthMs: 7 * 86_400_000,
          scope: Option.none(),
          used: 9,
          span: {
            start: at("2026-11-10T00:00:00Z"),
            reset: at("2026-11-17T00:00:00Z"),
          },
        },
        {
          lengthMs: 5 * 3_600_000,
          scope: Option.some("GPT-5.3-Codex-Spark"),
          used: 3,
          span: undefined,
        },
      ],
    },
  },
] as const;

type Provider = (typeof readers)[number]["provider"];

/** A change to a fixture that makes it unreadable, as the quota readers spec's decoding rules say. */
type Mutation =
  | { readonly _tag: "Remove"; readonly path: ReadonlyArray<string | number> }
  | {
      readonly _tag: "Set";
      readonly path: ReadonlyArray<string | number>;
      readonly value: unknown;
    };

const notFinite = "__not_finite__";

const remove = (...path: Array<string | number>): Mutation => ({
  _tag: "Remove",
  path,
});
const set = (value: unknown, ...path: Array<string | number>): Mutation => ({
  _tag: "Set",
  path,
  value,
});

/** For each reader, every field it reads made missing, of another type or not finite, and its windows emptied: each one unreadable. */
const mutations: Record<Provider, ReadonlyArray<Mutation>> = {
  zai: [
    remove("data"),
    remove("data", "limits"),
    set("limits", "data"),
    set({}, "data", "limits"),
    set([], "data", "limits"),
    set(7, "data", "level"),
    ...[0, 1, 2].flatMap((entry) => [
      remove("data", "limits", entry, "type"),
      remove("data", "limits", entry, "unit"),
      remove("data", "limits", entry, "number"),
      set(7, "data", "limits", entry, "type"),
      set("3", "data", "limits", entry, "unit"),
      set(3.5, "data", "limits", entry, "unit"),
      set("5", "data", "limits", entry, "number"),
      set(0.5, "data", "limits", entry, "number"),
      set("1000", "data", "limits", entry, "usage"),
      set(true, "data", "limits", entry, "currentValue"),
      set("33", "data", "limits", entry, "percentage"),
      set("soon", "data", "limits", entry, "nextResetTime"),
      set(1.5, "data", "limits", entry, "nextResetTime"),
      set(notFinite, "data", "limits", entry, "usage"),
      set(notFinite, "data", "limits", entry, "currentValue"),
      set(notFinite, "data", "limits", entry, "percentage"),
    ]),
    set("x", "data", "limits", 3, "unit"),
    set([{ type: "TOKENS_LIMIT", unit: 2, number: 1 }], "data", "limits"),
  ],
  "opencode-go": [
    remove("usage"),
    set([], "usage"),
    set("all", "usage"),
    set({ rolling: null, weekly: null, monthly: null }, "usage"),
    set({}, "usage"),
    ...["rolling", "weekly", "monthly"].flatMap((window) => [
      set(5, "usage", window),
      remove("usage", window, "percent"),
      remove("usage", window, "resetsAt"),
      set("41", "usage", window, "percent"),
      set(notFinite, "usage", window, "percent"),
      set(1794573000, "usage", window, "resetsAt"),
      set("next week", "usage", window, "resetsAt"),
      set("2026-11-13", "usage", window, "resetsAt"),
    ]),
  ],
  anthropic: [
    set({ five_hour: null, seven_day: null, limits: [] }),
    set("x", "limits"),
    set({}, "limits"),
    ...["five_hour", "seven_day"].flatMap((window) => [
      set("x", window),
      remove(window, "utilization"),
      set("41", window, "utilization"),
      set(notFinite, window, "utilization"),
      remove(window, "resets_at"),
      set(1794574800, window, "resets_at"),
      set("tomorrow", window, "resets_at"),
    ]),
    remove("limits", 0, "percent"),
    set("30", "limits", 0, "percent"),
    set(notFinite, "limits", 0, "percent"),
    remove("limits", 0, "resets_at"),
    set("next week", "limits", 0, "resets_at"),
  ],
  chatgpt: [
    set({ plan_type: "pro", rate_limit: null, additional_rate_limits: [] }),
    set(7, "plan_type"),
    set("x", "rate_limit"),
    set({}, "additional_rate_limits"),
    ...["primary_window", "secondary_window"].flatMap((window) => [
      set("x", "rate_limit", window),
      remove("rate_limit", window, "used_percent"),
      set("22", "rate_limit", window, "used_percent"),
      set(notFinite, "rate_limit", window, "used_percent"),
      remove("rate_limit", window, "limit_window_seconds"),
      set(1.5, "rate_limit", window, "limit_window_seconds"),
      remove("rate_limit", window, "reset_at"),
      set("1794574800", "rate_limit", window, "reset_at"),
    ]),
    set(7, "additional_rate_limits", 0, "limit_name"),
    set(7, "additional_rate_limits", 0, "metered_feature"),
    set("x", "additional_rate_limits", 0, "rate_limit"),
    remove(
      "additional_rate_limits",
      0,
      "rate_limit",
      "primary_window",
      "used_percent",
    ),
    set(
      0.5,
      "additional_rate_limits",
      0,
      "rate_limit",
      "primary_window",
      "reset_at",
    ),
  ],
};

const clone = (value: unknown): unknown => structuredClone(value);

const applied = (fixture: unknown, mutation: Mutation): unknown => {
  if (mutation._tag === "Set" && mutation.path.length === 0) {
    return clone(mutation.value);
  }
  const copy = clone(fixture);
  const parentPath = mutation.path.slice(0, -1);
  const key = mutation.path.at(-1);
  let parent: unknown = copy;
  for (const segment of parentPath) {
    parent =
      typeof parent === "object" && parent !== null
        ? Reflect.get(parent, segment)
        : undefined;
  }
  if (typeof parent !== "object" || parent === null || key === undefined) {
    return copy;
  }
  if (mutation._tag === "Remove") Reflect.deleteProperty(parent, key);
  else Reflect.set(parent, key, mutation.value);
  return copy;
};

const textOf = (value: unknown): string =>
  JSON.stringify(value).replaceAll(`"${notFinite}"`, "1e999");

const json = (text: string): FakeProvider.Script => ({
  headers: [["content-type", "application/json"]],
  chunks: [text],
});

const poolOf = (provider: Provider, base: string) =>
  Effect.gen(function* () {
    const fake = yield* FakeProvider.FakeProvider;
    const { pool, login } = poolFor(provider, `${fake.url}${base}`);
    return { pool, reader: Option.getOrThrow(Readers.readerOf(pool, login)) };
  });

const readOnce = (provider: Provider, base: string) =>
  Effect.gen(function* () {
    const { pool, reader } = yield* poolOf(provider, base);
    return yield* Effect.exit((yield* QuotaReader).read(pool, reader));
  });

/** A reading as plain values, its windows by length in milliseconds. */
const plainOf = (reading: {
  readonly windows: ReadonlyArray<{
    readonly length: Duration.Duration;
    readonly scope: Option.Option<string>;
    readonly used: number;
    readonly span?: {
      readonly start: DateTime.Utc;
      readonly reset: DateTime.Utc;
    };
    readonly source: string;
    readonly observedAt: DateTime.Utc;
  }>;
  readonly plan: Option.Option<string>;
}) => ({
  plan: reading.plan,
  windows: reading.windows.map((window) => {
    expect(window.source).toBe("reading");
    expect(window.observedAt).toEqual(UsageAnswers.readAt);
    return {
      lengthMs: Duration.toMillis(window.length),
      scope: window.scope,
      used: window.used,
      span: window.span,
    };
  }),
});

const mutated = Arbitrary.all({
  reader: QuotaLog.int(0, readers.length - 1),
  first: QuotaLog.int(0, 1000),
  second: QuotaLog.int(0, 1000),
  both: QuotaLog.pick([false, false, true]),
});

/** The quota readers and token endpoints over HTTP, the ones a quota login reads and refreshes at pointed at the fake provider. */
const over = Layer.unwrap(
  Effect.map(FakeProvider.FakeProvider, (fake) =>
    Layer.mergeAll(
      QuotaReaders.layer({
        anthropic: `${fake.url}${Harness.quotaPaths.anthropicUsage}`,
        chatgpt: `${fake.url}${Harness.quotaPaths.chatgptUsage}`,
      }),
      TokenEndpointsOverHttp.layer({
        anthropic: `${fake.url}${Harness.quotaPaths.anthropicToken}`,
        chatgpt: `${fake.url}${Harness.quotaPaths.chatgptToken}`,
      }),
    ),
  ),
).pipe(Layer.provideMerge(FakeProvider.layer));

layer(over)("the quota readers against the fake provider", (it) => {
  it.effect(
    "U5: each reader reads its constructed fixture into literal windows and plan",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        yield* TestClock.setTime(DateTime.toEpochMillis(UsageAnswers.readAt));
        for (const reader of readers) {
          fake.answer(json(textOf(reader.fixture)));
          const exit = yield* readOnce(reader.provider, reader.base);
          expect(Exit.isSuccess(exit), reader.provider).toBe(true);
          if (Exit.isSuccess(exit)) {
            expect(plainOf(exit.value)).toEqual(reader.reading);
          }
          expect(fake.last().target).toBe(reader.target);
        }
      }),
  );

  it.effect.prop(
    "U5: each reader turns a 2xx answer that does not decode, or that gives no window, into the failure unreadable, never into a reading",
    { mutated },
    ({ mutated }) =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        const reader = readers[mutated.reader] ?? readers[0];
        const choices = mutations[reader.provider];
        const first = choices[mutated.first % choices.length];
        const second = choices[mutated.second % choices.length];
        if (first === undefined || second === undefined) return;
        const answer = mutated.both
          ? applied(applied(reader.fixture, first), second)
          : applied(reader.fixture, first);
        fake.answer({
          status: 200 + (mutated.second % 4),
          ...json(textOf(answer)),
        });
        const exit = yield* readOnce(reader.provider, reader.base);
        expect(exit._tag, JSON.stringify([first, second])).toBe("Failure");
        if (Exit.isFailure(exit)) {
          const failure = Option.getOrThrow(Exit.findErrorOption(exit));
          expect(failure).toMatchObject({
            _tag: "ReadFailure",
            kind: "unreadable",
            status: Option.some(200 + (mutated.second % 4)),
          });
        }
      }),
    { arbitrary: { runs: 150 } },
  );

  it.effect(
    "U5: each change of each reader's fixture that the spec's decoding refuses, alone, is the failure unreadable",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        for (const reader of readers) {
          for (const mutation of mutations[reader.provider]) {
            fake.answer(json(textOf(applied(reader.fixture, mutation))));
            const exit = yield* readOnce(reader.provider, reader.base);
            expect(
              Option.map(Exit.findErrorOption(exit), (failure) =>
                failure._tag === "ReadFailure" ? failure.kind : failure._tag,
              ),
              JSON.stringify([reader.provider, mutation]),
            ).toEqual(Option.some("unreadable"));
          }
        }
      }),
  );

  it.effect(
    "U5: a Z.ai answer whose windows are all of units the reader does not know, or none long, is unreadable",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        fake.answer(
          json(
            JSON.stringify({
              data: {
                level: "pro",
                limits: [
                  { type: "TOKENS_LIMIT", unit: 2, number: 1, percentage: 1 },
                  { type: "TOKENS_LIMIT", unit: 3, number: 0, percentage: 1 },
                ],
              },
            }),
          ),
        );
        const exit = yield* readOnce("zai", "/api/coding/paas/v4");
        expect(Exit.findErrorOption(exit)).toEqual(
          Option.some(
            expect.objectContaining({
              kind: "unreadable",
              detail:
                "Z.ai's usage answer could not be read: it gives no window.",
            }),
          ),
        );
      }),
  );

  it.effect(
    "U6: every call to a usage endpoint sends User-Agent: cota/<version>, and is abandoned 10 seconds after it was sent",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        for (const reader of readers) {
          fake.forget();
          fake.answer(json(textOf(reader.fixture)));
          yield* readOnce(reader.provider, reader.base);
          expect(
            fake.last().headers.find(([name]) => name === "user-agent"),
          ).toEqual(["user-agent", `cota/${hubPackage.version}`]);

          fake.forget();
          fake.answer({ headersAfterMs: "never" });
          const reading = yield* Effect.forkChild(
            readOnce(reader.provider, reader.base),
          );
          expect(yield* Harness.waitUntil(() => fake.seen().length === 1)).toBe(
            true,
          );
          expect(
            fake.last().headers.find(([name]) => name === "user-agent"),
          ).toEqual(["user-agent", `cota/${hubPackage.version}`]);
          yield* TestClock.adjust(Duration.millis(9_999));
          yield* Effect.promise(() => Bun.sleep(20));
          expect(reading.pollUnsafe(), reader.provider).toBeUndefined();
          yield* TestClock.adjust(Duration.millis(1));
          const exit = yield* Fiber.join(reading);
          expect(Exit.findErrorOption(exit)).toEqual(
            Option.some(
              expect.objectContaining({
                kind: "unreachable",
                status: Option.none(),
              }),
            ),
          );
          const signal = fake.last().signal;
          expect(yield* Harness.waitUntil(() => signal.aborted)).toBe(true);
        }
      }),
  );

  it.effect(
    "U6: every call to a token endpoint sends User-Agent: cota/<version>, and is abandoned 10 seconds after it was sent",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        const tokenEndpoints = yield* TokenEndpoints;
        for (const [login, target, provider] of [
          [claudeLogin, Harness.quotaPaths.anthropicToken, "Anthropic"],
          [chatGptLogin, Harness.quotaPaths.chatgptToken, "OpenAI"],
        ] as const) {
          fake.forget();
          fake.answer(
            json(
              JSON.stringify({ access_token: "access-2", expires_in: 3600 }),
            ),
          );
          const refreshed = yield* Effect.exit(tokenEndpoints.refresh(login));
          expect(Exit.isSuccess(refreshed), provider).toBe(true);
          expect([fake.last().method, fake.last().target]).toEqual([
            "POST",
            target,
          ]);
          expect(
            fake.last().headers.find(([name]) => name === "user-agent"),
          ).toEqual(["user-agent", `cota/${hubPackage.version}`]);

          fake.forget();
          fake.answer({ headersAfterMs: "never" });
          const refreshing = yield* Effect.forkChild(
            Effect.exit(tokenEndpoints.refresh(login)),
          );
          expect(yield* Harness.waitUntil(() => fake.seen().length === 1)).toBe(
            true,
          );
          expect(
            fake.last().headers.find(([name]) => name === "user-agent"),
          ).toEqual(["user-agent", `cota/${hubPackage.version}`]);
          yield* TestClock.adjust(Duration.millis(9_999));
          yield* Effect.promise(() => Bun.sleep(20));
          expect(refreshing.pollUnsafe(), provider).toBeUndefined();
          yield* TestClock.adjust(Duration.millis(1));
          const exit = yield* Fiber.join(refreshing);
          expect(Exit.findErrorOption(exit)).toEqual(
            Option.some(
              expect.objectContaining({
                kind: "unreachable",
                status: Option.none(),
                detail: `${provider}'s token endpoint did not answer within 10 seconds.`,
              }),
            ),
          );
          const signal = fake.last().signal;
          expect(yield* Harness.waitUntil(() => signal.aborted)).toBe(true);
        }
      }),
  );
});
