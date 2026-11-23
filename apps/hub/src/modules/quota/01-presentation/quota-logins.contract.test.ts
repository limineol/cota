import { expect, layer } from "@effect/vitest";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import * as QuotaLogins from "#modules/quota/05-tests/quota-logins.ts";
import * as UsageAnswers from "#modules/quota/05-tests/usage-answers.ts";
import * as FakeProvider from "#shared/05-tests/fake-provider.ts";
import * as Harness from "#shared/05-tests/harness.ts";

const reader = { "x-cota-key": Harness.secrets.readerHubKey };

const json = (value: unknown, status = 200): FakeProvider.Script => ({
  status,
  headers: [["content-type", "application/json"]],
  chunks: [JSON.stringify(value)],
});

const claudeBody = {
  provider: "anthropic",
  accessToken: "claude-access-7d41",
  refreshToken: "claude-refresh-7d41",
  endsAt: "2026-11-12T08:00:00Z",
  subscriptionType: "max",
  rateLimitTier: "default_claude_max_20x",
};

const put = (pool: string, body: unknown, headers: Record<string, string>) =>
  Harness.send(`/api/pools/${pool}/quota-login`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const remove = (pool: string, headers: Record<string, string>) =>
  Harness.send(`/api/pools/${pool}/quota-login`, {
    method: "DELETE",
    headers,
  });

const asJson = (response: Response) =>
  Effect.gen(function* () {
    const text = yield* Harness.textOf(response);
    return {
      status: response.status,
      body: text === "" ? null : JSON.parse(text),
    };
  });

const poolsAnswer = Effect.gen(function* () {
  const answer = yield* Harness.send("/api/pools", { headers: reader });
  return {
    status: answer.status,
    text: yield* Harness.textOf(answer),
  };
});

const poolNamed = (text: string, id: string) =>
  JSON.parse(text).pools.find((pool: { id: string }) => pool.id === id);

const seenAt = (path: string) =>
  Effect.map(FakeProvider.FakeProvider, (fake) =>
    fake.seen().filter(({ target }) => target === path),
  );

layer(Harness.layer())("the quota logins of the pools group", (it) => {
  it.effect(
    "keeps a Claude login given for a Claude subscription pool, reads the pool's usage endpoint with it, and answers its state, never a token",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        const owner = yield* Harness.signIn();
        fake.forget();
        fake.answer((seen) =>
          seen.target === Harness.quotaPaths.anthropicUsage
            ? json(UsageAnswers.anthropicConstructed)
            : json({}),
        );
        const given = yield* asJson(yield* put("claude", claudeBody, owner));
        const read = yield* poolsAnswer;
        const forgotten = yield* asJson(yield* remove("claude", owner));
        const after = yield* poolsAnswer;

        expect(given).toEqual({
          status: 200,
          body: {
            provider: "anthropic",
            state: "active",
            givenAt: "2026-11-12T00:00:00.000Z",
            refreshedAt: null,
            endsAt: "2026-11-12T08:00:00.000Z",
            expiredAt: null,
          },
        });
        const claude = poolNamed(read.text, "claude");
        expect({
          plan: claude.plan,
          windows: claude.windows.map(
            (window: Record<string, unknown>) =>
              [
                window.lengthMs,
                window.scope,
                window.source,
                window.usedPercent,
                window.resetsAt,
              ] as const,
          ),
          reading: claude.reading,
          quotaLogin: claude.quotaLogin,
        }).toEqual({
          plan: "Max 20x",
          windows: [
            [18_000_000, null, "reading", 41, "2026-11-13T13:00:00.000Z"],
            [604_800_000, null, "reading", 12.5, "2026-11-17T00:00:00.000Z"],
            [
              604_800_000,
              "Claude Opus",
              "reading",
              30,
              "2026-11-17T00:00:00.000Z",
            ],
          ],
          reading: {
            at: "2026-11-12T00:00:00.000Z",
            failure: null,
            nextAttemptAt: "2026-11-12T00:02:00.000Z",
          },
          quotaLogin: given.body,
        });
        const usage = yield* seenAt(Harness.quotaPaths.anthropicUsage);
        expect(
          usage.map(({ method, headers }) => {
            const named = new Map(headers);
            return [
              method,
              named.get("authorization"),
              named.get("anthropic-beta"),
              named.get("accept"),
            ];
          }),
        ).toEqual([
          [
            "GET",
            "Bearer claude-access-7d41",
            "oauth-2025-04-20",
            "application/json",
          ],
        ]);
        expect(forgotten).toEqual({ status: 204, body: null });
        expect(poolNamed(after.text, "claude")).toMatchObject({
          plan: null,
          reading: null,
          quotaLogin: {
            provider: "anthropic",
            state: "none",
            givenAt: null,
            refreshedAt: null,
            endsAt: null,
            expiredAt: null,
          },
        });
        expect(yield* seenAt(Harness.quotaPaths.anthropicUsage)).toHaveLength(
          1,
        );
        for (const text of [read.text, after.text]) {
          expect(text).not.toContain(claudeBody.accessToken);
          expect(text).not.toContain(claudeBody.refreshToken);
        }
      }),
  );

  it.effect(
    "refreshes a ChatGPT login whose access token ends within 5 minutes before it reads, as Codex does, and keeps the refreshed login",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        const owner = yield* Harness.signIn();
        const now = Date.parse("2026-11-12T00:00:00Z") / 1000;
        const ending = QuotaLogins.jwt(Option.some(now + 299), "first");
        const fresh = QuotaLogins.jwt(Option.some(now + 864_000), "second");
        fake.forget();
        fake.answer((seen) => {
          if (seen.target === Harness.quotaPaths.chatgptToken) {
            return json({
              access_token: fresh,
              refresh_token: "chatgpt-refresh-2",
            });
          }
          if (seen.target === Harness.quotaPaths.chatgptUsage) {
            return json(UsageAnswers.chatGptConstructed);
          }
          return json({});
        });
        const given = yield* asJson(
          yield* put(
            "codex",
            {
              provider: "chatgpt",
              accessToken: ending,
              refreshToken: "chatgpt-refresh-1",
              accountId: "account-0b7e",
            },
            owner,
          ),
        );
        const read = yield* poolsAnswer;
        yield* remove("codex", owner);

        expect(given.body).toMatchObject({
          state: "active",
          endsAt: "2026-11-12T00:04:59.000Z",
        });
        const tokens = yield* seenAt(Harness.quotaPaths.chatgptToken);
        expect(
          tokens.map(({ method, headers, body }) => {
            const named = new Map(headers);
            return [
              method,
              named.get("content-type"),
              named.get("accept"),
              JSON.parse(new TextDecoder().decode(body)),
            ];
          }),
        ).toEqual([
          [
            "POST",
            "application/json",
            "application/json",
            {
              client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
              grant_type: "refresh_token",
              refresh_token: "chatgpt-refresh-1",
            },
          ],
        ]);
        const usage = yield* seenAt(Harness.quotaPaths.chatgptUsage);
        expect(
          usage.map(({ headers }) => {
            const named = new Map(headers);
            return [
              named.get("authorization"),
              named.get("chatgpt-account-id"),
            ];
          }),
        ).toEqual([[`Bearer ${fresh}`, "account-0b7e"]]);
        const codex = poolNamed(read.text, "codex");
        expect({
          plan: codex.plan,
          windows: codex.windows.map(
            (window: Record<string, unknown>) =>
              [
                window.lengthMs,
                window.scope,
                window.usedPercent,
                window.resetsAt,
              ] as const,
          ),
          quotaLogin: codex.quotaLogin,
        }).toEqual({
          plan: "Pro 20x",
          windows: [
            [18_000_000, null, 22, "2026-11-13T13:00:00.000Z"],
            [604_800_000, null, 9, "2026-11-17T00:00:00.000Z"],
            [18_000_000, "GPT-5.3-Codex-Spark", 3, null],
          ],
          quotaLogin: {
            provider: "chatgpt",
            state: "active",
            givenAt: "2026-11-12T00:00:00.000Z",
            refreshedAt: "2026-11-12T00:00:00.000Z",
            endsAt: "2026-11-22T00:00:00.000Z",
            expiredAt: null,
          },
        });
      }),
  );

  it.effect(
    "G9: a quota login for a pool that takes none, or that takes the other provider's, is answered 400 quota-login-not-taken, and the hub store does not change",
    () =>
      Effect.gen(function* () {
        const owner = yield* Harness.signIn();
        const fake = yield* FakeProvider.FakeProvider;
        fake.answer(json({}));
        yield* put("solo", claudeBody, owner);
        const chatGpt = {
          provider: "chatgpt",
          accessToken: "chatgpt-access-55d0",
          refreshToken: "chatgpt-refresh-55d0",
          accountId: "account-55d0",
        };
        const refused = [];
        for (const [pool, body] of [
          ["work", claudeBody],
          ["console", claudeBody],
          ["open", chatGpt],
          ["gone", chatGpt],
          ["codex", claudeBody],
          ["solo", chatGpt],
          ["claude", chatGpt],
          ["gemini", claudeBody],
        ] as const) {
          refused.push(yield* asJson(yield* put(pool, body, owner)));
        }
        const states = Object.fromEntries(
          JSON.parse((yield* poolsAnswer).text).pools.map(
            (pool: { id: string; quotaLogin: { state: string } | null }) => [
              pool.id,
              pool.quotaLogin?.state ?? null,
            ],
          ),
        );
        yield* remove("solo", owner);

        const problem = (detail: string) => ({
          status: 400,
          body: {
            type: "urn:cota:quota-login-not-taken",
            status: 400,
            title: "This pool does not take that quota login.",
            detail,
          },
        });
        expect(refused).toEqual([
          problem(
            'The pool "work" is a keyed pool: only a subscription pool takes a quota login.',
          ),
          problem(
            'The pool "console" is a keyed pool: only a subscription pool takes a quota login.',
          ),
          problem(
            'The pool "open" is a keyed pool: only a subscription pool takes a quota login.',
          ),
          problem(
            'The pool "gone" is a keyed pool: only a subscription pool takes a quota login.',
          ),
          problem('The pool "codex" takes a ChatGPT login, not a Claude one.'),
          problem('The pool "solo" takes a Claude login, not a ChatGPT one.'),
          problem('The pool "claude" takes a Claude login, not a ChatGPT one.'),
          problem(
            'The pool "gemini" is an observed pool: only a subscription pool takes a quota login.',
          ),
        ]);
        expect(states).toEqual({
          claude: "none",
          codex: "none",
          console: null,
          gemini: null,
          gone: null,
          open: null,
          personal: "none",
          solo: "active",
          work: null,
        });
      }),
  );

  it.effect(
    "answers 404 for a pool the hub does not have, and for forgetting a login a pool does not have",
    () =>
      Effect.gen(function* () {
        const owner = yield* Harness.signIn();
        expect([
          yield* asJson(yield* put("nowhere", claudeBody, owner)),
          yield* asJson(yield* remove("nowhere", owner)),
          yield* asJson(yield* remove("personal", owner)),
        ]).toEqual([
          {
            status: 404,
            body: {
              type: "urn:cota:no-such-pool",
              status: 404,
              title: "The hub has no such pool.",
              detail: 'The hub has no pool "nowhere".',
            },
          },
          {
            status: 404,
            body: {
              type: "urn:cota:no-such-pool",
              status: 404,
              title: "The hub has no such pool.",
              detail: 'The hub has no pool "nowhere".',
            },
          },
          {
            status: 404,
            body: {
              type: "urn:cota:no-quota-login",
              status: 404,
              title: "The pool has no quota login.",
              detail: 'The pool "personal" has no quota login.',
            },
          },
        ]);
      }),
  );

  it.effect(
    "G1: a login whose token is too long, or holds a space, is answered 400 without the token",
    () =>
      Effect.gen(function* () {
        const owner = yield* Harness.signIn();
        const long = "t".repeat(16_385);
        const spaced = "access token-91f3";
        const answers = [];
        for (const accessToken of [long, spaced]) {
          for (const where of ["accessToken", "refreshToken"] as const) {
            const answer = yield* put(
              "claude",
              { ...claudeBody, [where]: accessToken },
              owner,
            );
            const text = yield* Harness.textOf(answer);
            answers.push([
              answer.status,
              text.includes(accessToken),
              text.includes(claudeBody.accessToken),
              text.includes(claudeBody.refreshToken),
            ]);
          }
        }
        expect(answers).toEqual(
          Array.from({ length: 4 }, () => [400, false, false, false]),
        );
      }),
  );

  it.effect(
    "a refused refresh makes the login expired: the pool is no longer read, and its state says so",
    () =>
      Effect.gen(function* () {
        const fake = yield* FakeProvider.FakeProvider;
        const owner = yield* Harness.signIn();
        const logs = yield* Harness.Logs;
        fake.forget();
        logs.forget();
        fake.answer((seen) =>
          seen.target === Harness.quotaPaths.anthropicToken
            ? json(
                {
                  error: "invalid_grant",
                  error_description: claudeBody.refreshToken,
                },
                400,
              )
            : json(UsageAnswers.anthropicConstructed),
        );
        yield* put(
          "personal",
          { ...claudeBody, endsAt: "2026-11-11T00:00:00Z" },
          owner,
        );
        const first = yield* poolsAnswer;
        yield* TestClock.adjust(Duration.minutes(5));
        const second = yield* poolsAnswer;
        yield* remove("personal", owner);

        for (const answer of [first, second]) {
          expect(poolNamed(answer.text, "personal")).toMatchObject({
            reading: null,
            plan: "Max 20x",
            quotaLogin: {
              state: "expired",
              refreshedAt: null,
              expiredAt: "2026-11-12T00:00:00.000Z",
            },
          });
        }
        expect(yield* seenAt(Harness.quotaPaths.anthropicToken)).toHaveLength(
          1,
        );
        expect(yield* seenAt(Harness.quotaPaths.anthropicUsage)).toHaveLength(
          0,
        );
        const body = new TextDecoder().decode(
          (yield* seenAt(Harness.quotaPaths.anthropicToken))[0]?.body,
        );
        expect(Object.fromEntries(new URLSearchParams(body))).toEqual({
          grant_type: "refresh_token",
          refresh_token: claudeBody.refreshToken,
          client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
        });
        const logged = logs
          .lines()
          .map((line) => JSON.parse(line))
          .filter(({ message }) => String(message).startsWith("quota login"));
        expect(
          logged.map(({ message, annotations }) => [message, annotations]),
        ).toEqual([["quota login expired", { pool: "personal" }]]);
        expect(logs.lines().join("\n")).not.toContain(claudeBody.refreshToken);
      }),
  );
});
