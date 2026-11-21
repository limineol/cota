import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";
import type { Asked } from "#modules/request-log/02-application/interfaces/prices.ts";
import { PoolId } from "#shared/03-domain/ids.ts";
import * as Price from "#shared/03-domain/price.ts";
import * as Prices from "./prices.ts";

const anthropicPricing =
  "https://platform.claude.com/docs/en/about-claude/pricing";
const openaiPricing = "https://developers.openai.com/api/docs/pricing";

const perMillion = (dollars: number) =>
  Option.getOrThrow(Prices.rateOf(dollars));

const rates = (input: number, output: number): Price.Rates => ({
  input: perMillion(input),
  output: perMillion(output),
});

const ownPrice: Price.Price = { base: rates(0.5, 1.5), tiers: [] };

const pool = (
  prices: string | undefined,
  ownPrices: Readonly<Record<string, Price.Price>> = {},
) => ({ prices: Option.fromUndefinedOr(prices), ownPrices });

const asked = (fields: Partial<Asked>): Asked => ({
  pool: PoolId.make("pool"),
  protocol: "anthropic-messages",
  model: "",
  servedModel: "",
  serviceTier: "",
  ...fields,
});

const inputRateOf = (price: Option.Option<Price.Price>) =>
  Option.map(price, ({ base }) => base.input);

const shippedPrices = Object.entries(Prices.lists).flatMap(([list, models]) =>
  Object.entries(models).flatMap(([model, { price, serviceTiers }]) => [
    { where: `${list}/${model}`, price },
    ...Object.entries(serviceTiers).map(([tier, each]) => ({
      where: `${list}/${model} (${tier})`,
      price: each,
    })),
  ]),
);

describe("rateOf", () => {
  it("turns dollars per million tokens into picodollars per token exactly", () => {
    expect([3, 0.075, 0.0028, 0.003625, 15.625, 0].map(Prices.rateOf)).toEqual(
      [3000000n, 75000n, 2800n, 3625n, 15625000n, 0n].map(Option.some),
    );
  });

  it("refuses a price finer than a picodollar per token, negative or not finite", () => {
    expect(
      [0.0000001, 0.1 + 0.2, -1, Number.NaN, Number.POSITIVE_INFINITY].map(
        Prices.rateOf,
      ),
    ).toEqual([
      Option.none(),
      Option.none(),
      Option.none(),
      Option.none(),
      Option.none(),
    ]);
  });
});

describe("priceOf", () => {
  it("prices a request by the model that served it, before the model asked for", () => {
    expect(
      inputRateOf(
        Prices.priceOf(
          pool("anthropic"),
          asked({ model: "claude-opus-5-5", servedModel: "claude-haiku-4-5" }),
        ),
      ),
    ).toEqual(Option.some(perMillion(1)));
  });

  it("prices a request by the model asked for when no model is said to have served it", () => {
    expect(
      inputRateOf(
        Prices.priceOf(pool("anthropic"), asked({ model: "claude-opus-5-5" })),
      ),
    ).toEqual(Option.some(perMillion(4)));
  });

  it("falls back to the model asked for when the list lacks the model that served it", () => {
    expect(
      inputRateOf(
        Prices.priceOf(
          pool("openai"),
          asked({
            protocol: "chatgpt-codex",
            model: "gpt-5.5",
            servedModel: "gpt-5.5-codex-internal",
          }),
        ),
      ),
    ).toEqual(Option.some(perMillion(5)));
  });

  it("tries an Anthropic model id without its trailing date", () => {
    expect(
      inputRateOf(
        Prices.priceOf(
          pool("anthropic"),
          asked({ model: "claude-opus-5-5-20261001" }),
        ),
      ),
    ).toEqual(Option.some(perMillion(4)));
  });

  it("keeps the date of a model id that is not Anthropic's", () => {
    expect(
      Prices.priceOf(
        pool("openai"),
        asked({ protocol: "chatgpt-codex", model: "gpt-5.5-20261001" }),
      ),
    ).toEqual(Option.none());
  });

  it("gives Anthropic's fast rates to a request that ran in fast mode", () => {
    expect(
      ["fast", "standard", ""].map((serviceTier) =>
        inputRateOf(
          Prices.priceOf(
            pool("anthropic"),
            asked({ model: "claude-opus-5-5", serviceTier }),
          ),
        ),
      ),
    ).toEqual([perMillion(8), perMillion(4), perMillion(4)].map(Option.some));
  });

  it("gives OpenAI's Fast rates to a Codex request at the priority service tier", () => {
    expect(
      ["priority", "flex", "default"].map((serviceTier) =>
        inputRateOf(
          Prices.priceOf(
            pool("openai"),
            asked({
              protocol: "chatgpt-codex",
              model: "gpt-5.3-codex",
              serviceTier,
            }),
          ),
        ),
      ),
    ).toEqual(
      [perMillion(3.5), perMillion(1.75), perMillion(1.75)].map(Option.some),
    );
  });

  it("keeps the standard price of a model whose list has no rates for the tier it ran in", () => {
    expect(
      inputRateOf(
        Prices.priceOf(
          pool("anthropic"),
          asked({ model: "claude-sonnet-4-6", serviceTier: "fast" }),
        ),
      ),
    ).toEqual(Option.some(perMillion(3)));
  });

  it("lets a pool's own price for a model win over its price list, whatever the tier", () => {
    expect(
      Prices.priceOf(
        pool("anthropic", { "claude-opus-5-5": ownPrice }),
        asked({ model: "claude-opus-5-5", serviceTier: "fast" }),
      ),
    ).toEqual(Option.some(ownPrice));
  });

  it("finds a pool's own price for a model without a price list", () => {
    expect(
      Prices.priceOf(
        pool(undefined, { "qwen3-coder": ownPrice }),
        asked({ protocol: "openai-chat", model: "qwen3-coder" }),
      ),
    ).toEqual(Option.some(ownPrice));
  });

  it("gives no price to a model or a service tier named after something every object has", () => {
    const inherited = [
      "constructor",
      "toString",
      "__proto__",
      "hasOwnProperty",
    ];
    expect(
      inherited.flatMap((name) => [
        Prices.priceOf(pool("anthropic"), asked({ model: name })),
        Prices.priceOf(
          pool(undefined),
          asked({ protocol: "openai-chat", model: name }),
        ),
      ]),
    ).toEqual(inherited.flatMap(() => [Option.none(), Option.none()]));
    expect(
      inherited.map((serviceTier) =>
        inputRateOf(
          Prices.priceOf(
            pool("anthropic"),
            asked({ model: "claude-sonnet-4-6", serviceTier }),
          ),
        ),
      ),
    ).toEqual(inherited.map(() => Option.some(perMillion(3))));
  });

  it("gives no price for a model the list lacks, or a pool without a list", () => {
    expect([
      Prices.priceOf(pool("anthropic"), asked({ model: "claude-unknown-9" })),
      Prices.priceOf(
        pool(undefined),
        asked({ protocol: "openai-chat", model: "glm-5.2" }),
      ),
      Prices.priceOf(pool("anthropic"), asked({})),
    ]).toEqual([Option.none(), Option.none(), Option.none()]);
  });
});

describe("the shipped price list", () => {
  it("ships the lists for anthropic, openai, opencode-go and zai", () => {
    expect(Prices.listNames).toEqual([
      "anthropic",
      "openai",
      "opencode-go",
      "zai",
    ]);
  });

  it("holds only prices that decode as the domain's Price.Price: rising tiers and rates of zero or more", () => {
    const file: unknown = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("prices.json", import.meta.url)),
        "utf8",
      ),
    );
    const decoded = Prices.decodeFile(file);
    expect(shippedPrices.length).toBeGreaterThan(100);
    for (const { where, price } of shippedPrices) {
      expect(Schema.is(Price.Price)(price), where).toBe(true);
      expect(
        price.tiers.every(
          (tier, index) =>
            index === 0 ||
            (price.tiers[index - 1]?.threshold ?? 0) < tier.threshold,
        ),
        where,
      ).toBe(true);
      const all = [price.base, ...price.tiers.map(({ rates }) => rates)];
      expect(
        all.every((each) => Object.values(each).every((rate) => rate >= 0n)),
        where,
      ).toBe(true);
    }
    expect(decoded.lists).toEqual(Prices.lists);
  });

  it(`prices Claude Opus 5.5 at $4 and $20, $5 and $8 to write the cache for 5 minutes and an hour, $0.20 to read it, and $8 and $40 in fast mode (${anthropicPricing}), with models.dev's limits of 1,000,000 tokens in and 128,000 out, and image input`, () => {
    expect(Prices.lists.anthropic?.["claude-opus-5-5"]).toEqual({
      name: "Claude Opus 5.5",
      contextTokens: 1_000_000,
      outputTokens: 128_000,
      imageInput: true,
      price: {
        base: {
          input: perMillion(4),
          output: perMillion(20),
          cacheRead: perMillion(0.2),
          cacheWriteShort: perMillion(5),
          cacheWriteLong: perMillion(8),
        },
        tiers: [],
      },
      serviceTiers: {
        fast: {
          base: {
            input: perMillion(8),
            output: perMillion(40),
            cacheRead: perMillion(0.4),
            cacheWriteShort: perMillion(10),
            cacheWriteLong: perMillion(16),
          },
          tiers: [],
        },
      },
    });
  });

  it(`prices Claude Haiku 5.5 higher for prompts over 100,000 tokens (${anthropicPricing})`, () => {
    expect(Prices.lists.anthropic?.["claude-haiku-5-5"]?.price).toEqual({
      base: {
        input: perMillion(0.1),
        output: perMillion(0.5),
        cacheRead: perMillion(0.01),
        cacheWriteShort: perMillion(0.125),
        cacheWriteLong: perMillion(0.2),
      },
      tiers: [
        {
          threshold: 100000,
          rates: {
            input: perMillion(0.5),
            output: perMillion(2.5),
            cacheRead: perMillion(0.05),
            cacheWriteShort: perMillion(0.625),
            cacheWriteLong: perMillion(1),
          },
        },
      ],
    });
  });

  it(`prices Claude Sonnet 4.5 at $3 and $15, and $6 for an hour's cache write (${anthropicPricing})`, () => {
    expect(Prices.lists.anthropic?.["claude-sonnet-4-5"]?.price.base).toEqual({
      input: perMillion(3),
      output: perMillion(15),
      cacheRead: perMillion(0.3),
      cacheWriteShort: perMillion(3.75),
      cacheWriteLong: perMillion(6),
    });
  });

  it(`prices gpt-5.5 at $5 and $30, $10 and $45 for prompts over 272K tokens, and $12.50 and $75 at the priority tier (${openaiPricing}), with models.dev's limits of 1,050,000 tokens in and 128,000 out, and image input`, () => {
    expect(Prices.lists.openai?.["gpt-5.5"]).toEqual({
      name: "GPT-5.5",
      contextTokens: 1_050_000,
      outputTokens: 128_000,
      imageInput: true,
      price: {
        base: {
          input: perMillion(5),
          output: perMillion(30),
          cacheRead: perMillion(0.5),
        },
        tiers: [
          {
            threshold: 272000,
            rates: {
              input: perMillion(10),
              output: perMillion(45),
              cacheRead: perMillion(1),
            },
          },
        ],
      },
      serviceTiers: {
        priority: {
          base: {
            input: perMillion(12.5),
            output: perMillion(75),
            cacheRead: perMillion(1.25),
          },
          tiers: [],
        },
      },
    });
  });

  it(`prices gpt-5.3-codex at $1.75 and $14, and $3.50 and $28 at the priority tier (${openaiPricing})`, () => {
    const codex = Prices.lists.openai?.["gpt-5.3-codex"];
    expect([codex?.price.base, codex?.serviceTiers.priority?.base]).toEqual([
      {
        input: perMillion(1.75),
        output: perMillion(14),
        cacheRead: perMillion(0.175),
      },
      {
        input: perMillion(3.5),
        output: perMillion(28),
        cacheRead: perMillion(0.35),
      },
    ]);
  });
});
