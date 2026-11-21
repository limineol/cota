import { describe, expect, it, layer } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import * as Generated from "#modules/recording/05-tests/generated.ts";
import * as Replay from "#shared/05-tests/replay/replay.ts";
import * as Scrubber from "./scrubber.ts";

const seed = Arbitrary.schema(
  Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 2 ** 31 - 1 })),
);

const runs = (count: number) => ({
  timeout: 60_000,
  arbitrary: { runs: count },
});

const decodeExchangeFile = Schema.decodeUnknownSync(
  Schema.fromJsonString(Replay.ExchangeFile),
);
describe("scrubber laws", () => {
  it.effect.prop(
    "S1: No string of an exchange survives the scrubber unless it is one of its protocol's own words or a fake: not in a value, a key, a header, a nested JSON string, a JWT's payload or a tool input spread over deltas.",
    { seed },
    ({ seed }) =>
      Effect.sync(() => {
        const fakes = Scrubber.makeFakes();
        for (const { protocol, exchange } of Generated.exchanges(seed)) {
          const text = Scrubber.fileText(
            Scrubber.exchangeFileOf(
              protocol,
              exchange,
              fakes,
              Generated.recordedOn,
            ),
          );
          const found = Generated.readable(text).match(
            new RegExp(`.{0,40}${Generated.marker.source}.{0,40}`, "is"),
          );
          expect(found?.[0], `${protocol}, seed ${seed}`).toBeUndefined();
        }
      }),
    runs(150),
  );
});

layer(Replay.layer)("scrubber laws through the hub", (it) => {
  it.effect.prop(
    "S2: A scrubbed exchange decodes as an exchange file and replays through the hub into a request of the same shape as the original's: the same operation, outcome, usage, stop reason, session source, and number and types of items.",
    { seed },
    ({ seed }) =>
      Effect.gen(function* () {
        const fakes = Scrubber.makeFakes();
        for (const { protocol, exchange } of Generated.exchanges(seed)) {
          const before = yield* Replay.replay(
            Generated.loaded(
              protocol,
              Generated.asExchangeFile(Generated.withoutHubHeaders(exchange)),
            ),
            "whole",
          );
          const scrubbed = decodeExchangeFile(
            Scrubber.fileText(
              Scrubber.exchangeFileOf(
                protocol,
                exchange,
                fakes,
                Generated.recordedOn,
              ),
            ),
          );
          const after = yield* Replay.replay(
            Generated.loaded(protocol, scrubbed),
            "every 7 bytes",
          );
          expect(
            Generated.shapeOf(after.logged),
            `${protocol}, seed ${seed}`,
          ).toEqual(Generated.shapeOf(before.logged));
        }
      }),
    runs(20),
  );
});
