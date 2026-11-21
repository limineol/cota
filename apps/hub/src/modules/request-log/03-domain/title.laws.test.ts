import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as InMemorySessionTitles from "#modules/request-log/05-tests/fakes/in-memory-session-titles.ts";
import * as Sessions from "#modules/request-log/05-tests/sessions.ts";
import * as Generated from "#modules/request-log/05-tests/traffic.ts";

describe("reported titles", () => {
  it.effect.prop(
    "T9: storing the same reports in any order, and any of them twice, gives every session the same reported title",
    { storing: Sessions.storing },
    ({ storing }) =>
      Effect.gen(function* () {
        const titles = InMemorySessionTitles.make(
          InMemorySessionTitles.InMemorySessionTitles.of({
            reports: [],
            fails: false,
          }),
        );
        const { found, expected } = yield* Sessions.latestStored(
          titles,
          storing,
        );

        expect(Generated.plain(found)).toEqual(Generated.plain(expected));
      }),
  );
});
