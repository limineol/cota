import { expect, layer } from "@effect/vitest";
import { Arbitrary, Clock, Effect, Option, Schema } from "effect";
import { TestClock } from "effect/testing";
import { jwt } from "#modules/quota/05-tests/quota-logins.ts";
import * as UsageAnswers from "#modules/quota/05-tests/usage-answers.ts";
import * as Request from "#shared/03-domain/request.entity.ts";
import * as FakeProvider from "#shared/05-tests/fake-provider.ts";
import * as Harness from "#shared/05-tests/harness.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));
const pick = <const A extends readonly [unknown, ...Array<unknown>]>(
  values: A,
): Arbitrary.Arbitrary<A[number]> =>
  int(0, values.length - 1).pipe(
    Arbitrary.map((index): A[number] => values[index] ?? values[0]),
  );
const flag = Arbitrary.schema(Schema.Boolean);
const secret = Arbitrary.schema(
  Schema.String.check(Schema.isPattern(/^[A-Za-z0-9._~-]{12,40}$/)),
);

/** How the fake provider answers a token or usage endpoint. */
type Outcome = "good" | "refused" | "failed" | "unreadable" | "hung";
const outcomes = [
  "good",
  "refused",
  "failed",
  "unreadable",
  "hung",
] as const satisfies ReadonlyArray<Outcome>;

/** What the owner and the clock do in a scene. */
type Step = "read" | "keep" | "give badly" | "forget and give";

interface Scene {
  readonly secrets: {
    readonly claudeAccess: string;
    readonly claudeRefresh: string;
    readonly chatGptAccess: string;
    readonly chatGptRefresh: string;
    readonly accountId: string;
    readonly newAccess: string;
    readonly newRefresh: string;
  };
  readonly claudePool: "claude" | "personal" | "solo";
  readonly claudeDue: boolean;
  readonly chatGptDue: boolean;
  readonly tokens: Outcome;
  readonly usage: Outcome;
  readonly steps: ReadonlyArray<Step>;
}

let run = 0;

const json = (value: unknown, status = 200): FakeProvider.Script => ({
  status,
  headers: [["content-type", "application/json"]],
  chunks: [JSON.stringify(value)],
});

const text = (value: string, status: number): FakeProvider.Script => ({
  status,
  headers: [["content-type", "text/plain"]],
  chunks: [value],
});

const never: FakeProvider.Script = { headersAfterMs: "never" };

/** Answers of the token and usage endpoints that hold every token of the scene, as a careless provider might send them. */
const scriptOf =
  (scene: Scene, now: number, tokens: ReadonlyArray<string>) =>
  (seen: FakeProvider.Seen): FakeProvider.Script => {
    const echoed = tokens.join(" ");
    const { secrets } = scene;
    switch (seen.target) {
      case Harness.quotaPaths.anthropicToken:
      case Harness.quotaPaths.chatgptToken: {
        const chatGpt = seen.target === Harness.quotaPaths.chatgptToken;
        switch (scene.tokens) {
          case "good":
            return json({
              access_token: chatGpt
                ? jwt(Option.some(now / 1000 + 86_400), secrets.newAccess)
                : secrets.newAccess,
              refresh_token: secrets.newRefresh,
              expires_in: 28_800,
            });
          case "refused":
            return chatGpt
              ? json(
                  { error: { code: "refresh_token_reused", message: echoed } },
                  401,
                )
              : json(
                  { error: "invalid_grant", error_description: echoed },
                  400,
                );
          case "failed":
            return text(echoed, 500);
          case "unreadable":
            return json({ access_token: `${echoed} `, expires_in: echoed });
          case "hung":
            return never;
        }
        break;
      }
      case Harness.quotaPaths.anthropicUsage:
      case Harness.quotaPaths.chatgptUsage: {
        const chatGpt = seen.target === Harness.quotaPaths.chatgptUsage;
        switch (scene.usage) {
          case "good":
            return json(
              chatGpt
                ? UsageAnswers.chatGptConstructed
                : UsageAnswers.anthropicConstructed,
            );
          case "refused":
            return text(echoed, 401);
          case "failed":
            return text(echoed, 503);
          case "unreadable":
            return json({
              five_hour: { utilization: echoed },
              rate_limit: { primary_window: echoed },
            });
          case "hung":
            return never;
        }
      }
    }
    return json({});
  };

const put = (pool: string, body: unknown, headers: Record<string, string>) =>
  Harness.send(`/api/pools/${pool}/quota-login`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const answerOf = (response: Response) =>
  Effect.map(
    Harness.textOf(response),
    (body) =>
      `${response.status} ${JSON.stringify([...response.headers])} ${body}`,
  );

/** Lets every call the hub makes end: one that hangs is abandoned 10 seconds after it was sent, on the hub's clock. */
const settledOf = (scene: Scene) =>
  Harness.withTheClockRunning(
    Effect.sleep(
      scene.tokens === "hung" || scene.usage === "hung"
        ? "11 seconds"
        : "1 second",
    ),
  );

/**
 * Plays a scene against the whole hub and answers everything that left it
 * where the owner or an operator can see it: the API's answers, problems
 * among them, its log lines and the request log.
 */
const played = (scene: Scene) =>
  Effect.gen(function* () {
    const settled = settledOf(scene);
    yield* Harness.forgetEverything;
    const fake = yield* FakeProvider.FakeProvider;
    const logs = yield* Harness.Logs;
    const owner = yield* Harness.signIn();
    const reader = { "x-cota-key": Harness.secrets.readerHubKey };
    const now = yield* Clock.currentTimeMillis;
    run++;
    const { secrets } = scene;
    const chatGptAccess = jwt(
      Option.some(Math.floor(now / 1000) + (scene.chatGptDue ? 60 : 86_400)),
      `${run}-${secrets.chatGptAccess}`,
    );
    const tokens = [
      `${run}-${secrets.claudeAccess}`,
      `${run}-${secrets.claudeRefresh}`,
      chatGptAccess,
      `${run}-${secrets.chatGptRefresh}`,
      `${run}-${secrets.accountId}`,
      secrets.newAccess,
      jwt(Option.some(now / 1000 + 86_400), secrets.newAccess),
      secrets.newRefresh,
    ];
    const [claudeAccess = "", claudeRefresh = ""] = tokens;
    const claude = {
      provider: "anthropic",
      accessToken: claudeAccess,
      refreshToken: claudeRefresh,
      endsAt: new Date(
        now + (scene.claudeDue ? 60_000 : 86_400_000),
      ).toISOString(),
      subscriptionType: "max",
      rateLimitTier: "default_claude_max_20x",
    };
    const chatGpt = {
      provider: "chatgpt",
      accessToken: chatGptAccess,
      refreshToken: `${run}-${secrets.chatGptRefresh}`,
      accountId: `${run}-${secrets.accountId}`,
    };
    fake.answer(scriptOf(scene, now, tokens));
    const answers: Array<string> = [];
    const give = Effect.gen(function* () {
      answers.push(
        yield* answerOf(yield* put(scene.claudePool, claude, owner)),
      );
      answers.push(yield* answerOf(yield* put("codex", chatGpt, owner)));
    });
    const forget = Effect.gen(function* () {
      for (const pool of [scene.claudePool, "codex"]) {
        answers.push(
          yield* answerOf(
            yield* Harness.send(`/api/pools/${pool}/quota-login`, {
              method: "DELETE",
              headers: owner,
            }),
          ),
        );
      }
    });
    yield* give;
    for (const step of scene.steps) {
      switch (step) {
        case "read":
          answers.push(
            yield* answerOf(
              yield* Harness.withTheClockRunning(
                Harness.send("/api/pools", { headers: reader }),
              ),
            ),
          );
          break;
        case "keep":
          yield* TestClock.adjust("1 hour");
          yield* settled;
          break;
        case "give badly":
          for (const [pool, body] of [
            [scene.claudePool, { ...claude, accessToken: `${claudeAccess} ` }],
            [
              "codex",
              { ...chatGpt, refreshToken: `${chatGpt.refreshToken}\n` },
            ],
          ] as const) {
            answers.push(yield* answerOf(yield* put(pool, body, owner)));
          }
          break;
        case "forget and give":
          yield* forget;
          yield* give;
      }
    }
    answers.push(
      yield* answerOf(
        yield* Harness.withTheClockRunning(
          Harness.send("/api/pools", { headers: reader }),
        ),
      ),
    );
    yield* forget;
    yield* settled;
    const requests = yield* Harness.recorded(0);
    return {
      tokens,
      seen: answers.join("\n"),
      logged: logs.lines().join("\n"),
      requestLog: JSON.stringify(
        requests.map((request) => Schema.encodeSync(Request.Request)(request)),
      ),
    };
  });

const holdsG1 = (saw: Effect.Success<ReturnType<typeof played>>) => {
  for (const token of saw.tokens) {
    expect(saw.seen).not.toContain(token);
    expect(saw.logged).not.toContain(token);
    expect(saw.requestLog).not.toContain(token);
  }
};

const scene: Arbitrary.Arbitrary<Scene> = Arbitrary.all({
  secrets: Arbitrary.all({
    claudeAccess: secret,
    claudeRefresh: secret,
    chatGptAccess: secret,
    chatGptRefresh: secret,
    accountId: secret,
    newAccess: secret,
    newRefresh: secret,
  }),
  claudePool: pick(["claude", "personal", "solo"]),
  claudeDue: flag,
  chatGptDue: flag,
  tokens: pick(outcomes),
  usage: pick(outcomes),
  steps: Arbitrary.array(
    pick(["read", "read", "keep", "give badly", "forget and give"]),
    { minLength: 1, maxLength: 4 },
  ),
});

layer(Harness.layer())("quota logins laws, against the whole hub", (it) => {
  it.effect.prop(
    "G1: for generated quota logins and any sequence of gives, forgets, reads, refreshes, keep-alive checks and failures, no API answer, no problem, no log line and no request log row holds any of their tokens",
    { scene },
    ({ scene }) => Effect.map(played(scene), holdsG1),
    { timeout: 60_000, arbitrary: { runs: 30 } },
  );

  it.effect(
    "G1: token and usage endpoints that answer with every token in their bodies, refuse, fail, cannot be read or never answer put no token in an API answer, a problem, a log line or the request log",
    () =>
      Effect.gen(function* () {
        for (const [index, outcome] of outcomes.entries()) {
          const saw = yield* played({
            secrets: {
              claudeAccess: `claude-access-${index}-6f1d0c`,
              claudeRefresh: `claude-refresh-${index}-6f1d0c`,
              chatGptAccess: `chatgpt-access-${index}-6f1d0c`,
              chatGptRefresh: `chatgpt-refresh-${index}-6f1d0c`,
              accountId: `account-${index}-6f1d0c`,
              newAccess: `new-access-${index}-6f1d0c`,
              newRefresh: `new-refresh-${index}-6f1d0c`,
            },
            claudePool: "personal",
            claudeDue: true,
            chatGptDue: true,
            tokens: outcome,
            usage: outcomes[(index + 2) % outcomes.length] ?? "failed",
            steps: ["read", "give badly", "keep", "read"],
          });
          holdsG1(saw);
        }
      }),
    { timeout: 60_000 },
  );
});
