import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import * as PriceLists from "#modules/request-log/04-infrastructure/prices/prices.ts";
import * as Harness from "#shared/05-tests/harness.ts";

const fleet = { "x-cota-key": Harness.secrets.fleetHubKey };
const clients = { "x-cota-key": Harness.secrets.clientsHubKey };
const reader = { authorization: `Bearer ${Harness.secrets.readerHubKey}` };

interface Answer {
  readonly hubKey: unknown;
  readonly pools: ReadonlyArray<{
    readonly id: string;
    readonly displayName: string | null;
    readonly models: ReadonlyArray<{ readonly id: string }>;
  }>;
}

const machineOf = (headers: Record<string, string>) =>
  Effect.gen(function* () {
    const answer = yield* Harness.send("/api/machine", { headers });
    expect(answer.status).toBe(200);
    const text = yield* Harness.textOf(answer);
    const body: Answer = JSON.parse(text);
    return { text, body };
  });

const named = (kind: string, key: string, name: string) =>
  Effect.gen(function* () {
    const owner = yield* Harness.signIn();
    yield* Harness.send(`/api/display-names/${kind}/${key}`, {
      method: "PUT",
      headers: { ...owner, "content-type": "application/json" },
      body: JSON.stringify({ name }),
    }).pipe(Effect.andThen(Harness.textOf));
  });

const unnamed = (kind: string, key: string) =>
  Effect.gen(function* () {
    const owner = yield* Harness.signIn();
    yield* Harness.send(`/api/display-names/${kind}/${key}`, {
      method: "DELETE",
      headers: owner,
    });
  });

const withoutModels = (body: Answer) => ({
  ...body,
  pools: body.pools.map(({ models, ...pool }) => ({
    ...pool,
    models: models.length,
  })),
});

const anthropicModels = Object.keys(PriceLists.lists.anthropic ?? {}).length;

const keyedPools = [
  {
    id: "console",
    kind: "keyed",
    protocol: "anthropic-messages",
    provider: "anthropic",
    displayName: null,
    models: anthropicModels,
  },
  {
    id: "gone",
    kind: "keyed",
    protocol: "openai-chat",
    provider: "gone",
    displayName: null,
    models: 0,
  },
  {
    id: "open",
    kind: "keyed",
    protocol: "openai-chat",
    provider: "open",
    displayName: null,
    models: 0,
  },
  {
    id: "work",
    kind: "keyed",
    protocol: "openai-chat",
    provider: "zai",
    displayName: null,
    models: 0,
  },
];

const subscriptionPools = [
  {
    id: "claude",
    kind: "subscription",
    protocol: "anthropic-messages",
    provider: "anthropic",
    displayName: null,
    models: 0,
  },
  {
    id: "codex",
    kind: "subscription",
    protocol: "chatgpt-codex",
    provider: "chatgpt",
    displayName: null,
    models: 0,
  },
  {
    id: "personal",
    kind: "subscription",
    protocol: "anthropic-messages",
    provider: "anthropic",
    displayName: null,
    models: 0,
  },
  {
    id: "solo",
    kind: "subscription",
    protocol: "anthropic-messages",
    provider: "anthropic",
    displayName: null,
    models: 0,
  },
];

layer(Harness.layer())("the machine group", (it) => {
  it.effect(
    "answers a keyed hub key its name and scope and the keyed pools, in order of id, each with the models of its price list",
    () =>
      Effect.gen(function* () {
        const { body } = yield* machineOf(fleet);
        expect(withoutModels(body)).toEqual({
          hubKey: { name: "fleet", scope: "keyed" },
          pools: keyedPools,
        });
        expect(anthropicModels).toBeGreaterThan(10);
      }),
  );

  it.effect(
    "answers a model's name, limits, image input and price per million tokens as money, from the pool's price list",
    () =>
      Effect.gen(function* () {
        const { body } = yield* machineOf(fleet);
        const console = body.pools.find(({ id }) => id === "console");
        expect(
          console?.models.find(({ id }) => id === "claude-opus-5-5"),
        ).toEqual({
          id: "claude-opus-5-5",
          name: "Claude Opus 5.5",
          contextTokens: 1_000_000,
          outputTokens: 128_000,
          imageInput: true,
          price: {
            base: {
              input: "4.000000000000",
              cacheRead: "0.200000000000",
              cacheWriteShort: "5.000000000000",
              cacheWriteLong: "8.000000000000",
              output: "20.000000000000",
            },
            tiers: [],
          },
        });
      }),
  );

  it.effect(
    "answers a subscription hub key the subscription pools with no models, a reader key no pool, and the owner every pool with no hub key",
    () =>
      Effect.gen(function* () {
        expect(withoutModels((yield* machineOf(clients)).body)).toEqual({
          hubKey: { name: "clients", scope: "subscription" },
          pools: subscriptionPools,
        });
        expect((yield* machineOf(reader)).body).toEqual({
          hubKey: { name: "agents", scope: "reader" },
          pools: [],
        });
        expect(
          withoutModels((yield* machineOf(yield* Harness.signIn())).body),
        ).toEqual({
          hubKey: null,
          pools: [
            subscriptionPools[0],
            subscriptionPools[1],
            keyedPools[0],
            keyedPools[1],
            keyedPools[2],
            subscriptionPools[2],
            subscriptionPools[3],
            keyedPools[3],
          ],
        });
      }),
  );

  it.effect(
    "answers the owner's name for a pool, and for a model in place of its built-in one",
    () =>
      Effect.gen(function* () {
        yield* named("pool", "console", "Console");
        yield* named("model", "claude-opus-5-5", "Opus");
        const { body } = yield* machineOf(fleet);
        yield* unnamed("pool", "console");
        yield* unnamed("model", "claude-opus-5-5");
        const console = body.pools.find(({ id }) => id === "console");
        expect([
          withoutModels(body).pools[0]?.displayName,
          console?.models.find(({ id }) => id === "claude-opus-5-5"),
        ]).toMatchObject(["Console", { name: "Opus" }]);
      }),
  );

  it.effect("holds no hub key, held key or kept login in any answer", () =>
    Effect.gen(function* () {
      const texts = [
        (yield* machineOf(fleet)).text,
        (yield* machineOf(clients)).text,
        (yield* machineOf(reader)).text,
        (yield* machineOf(yield* Harness.signIn())).text,
      ];
      const secrets = [
        Harness.secrets.fleetHubKey,
        Harness.secrets.clientsHubKey,
        Harness.secrets.readerHubKey,
        Harness.secrets.heldKey,
        Harness.secrets.consoleKey,
        Harness.secrets.keptLogin,
      ];
      expect(
        texts.flatMap((text) =>
          secrets.filter((secret) => text.includes(secret)),
        ),
      ).toEqual([]);
    }),
  );
});
