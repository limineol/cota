import { expect, it } from "@effect/vitest";
import { Effect, HashMap, Layer, Option } from "effect";
import * as Fallback from "#modules/relay/03-domain/fallback.ts";
import * as AnthropicMessages from "#modules/relay/04-infrastructure/protocols/anthropic-messages/anthropic-messages.ts";
import * as ChatgptCodex from "#modules/relay/04-infrastructure/protocols/chatgpt-codex/chatgpt-codex.ts";
import { LoginFingerprint, ModelId, PoolId } from "#shared/03-domain/ids.ts";
import type * as Pool from "#shared/03-domain/pool.entity.ts";
import * as PlanCredential from "./plan-credential.query.ts";

const poolOf = (
  id: string,
  protocol: Pool.SubscriptionPool["protocol"],
): Pool.SubscriptionPool => ({
  kind: "subscription",
  id: PoolId.make(id),
  protocol,
  provider: protocol,
  baseUrl: "http://127.0.0.1:1",
  keptLogin: Option.none(),
  fallback: Option.none(),
  prices: Option.none(),
  ownPrices: {},
});

it.effect(
  "asks Fallback about a request to a pool whose refusal is told from the head, and never about one told from the body",
  () =>
    Effect.gen(function* () {
      const asked: Array<string> = [];
      const fallback = Fallback.Fallback.of({
        decide: (request) =>
          Effect.sync(() => {
            asked.push(request.pool);
            return { _tag: "Keep" };
          }),
        record: () => Effect.void,
        parkedUntil: () => Effect.succeedNone,
        forget: Effect.void,
      });
      const planCredential = yield* PlanCredential.PlanCredential.pipe(
        Effect.provide(
          PlanCredential.layer(HashMap.empty()).pipe(
            Layer.provide(Layer.succeed(Fallback.Fallback, fallback)),
          ),
        ),
      );
      const login = Option.some(LoginFingerprint.make("login-fingerprint"));
      const model = Option.some(ModelId.make("model-asked"));
      const claude = yield* planCredential.execute(
        poolOf("claude", "anthropic-messages"),
        AnthropicMessages.protocol,
        login,
        model,
      );
      const codex = yield* planCredential.execute(
        poolOf("codex", "chatgpt-codex"),
        ChatgptCodex.protocol,
        login,
        model,
      );
      expect([
        asked,
        Option.isSome(claude.onRefusal),
        Option.isSome(codex.onRefusal),
      ]).toEqual([["claude"], true, false]);
    }),
);
