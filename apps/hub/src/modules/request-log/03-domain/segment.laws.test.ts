import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import * as Generated from "#modules/request-log/05-tests/sessions.ts";
import type { Roled } from "./request-role.ts";
import { segmentsOf } from "./segment.ts";
import type { SessionRequest } from "./session.ts";
import { isRecordForm } from "./stored-protocol.ts";

const idsOf = (requests: ReadonlyArray<SessionRequest>) =>
  requests.map(({ id }) => id);

const mainOf = (roled: ReadonlyArray<Roled>) =>
  roled
    .filter(({ requestRole }) => requestRole === "main")
    .map(({ request }) => request);

/** The size the size rule reads of a request: its prompt size when it is `ok`. */
const sizeOf = (request: SessionRequest): Option.Option<number> =>
  request.outcome === "ok" ? request.promptSize : Option.none();

/** A compaction its client named: a record form's request whose purpose is `compaction`. */
const named = (request: SessionRequest): boolean =>
  isRecordForm(request.protocol) && request.purpose === "compaction";

describe("segments", () => {
  it.effect.prop(
    "T4: the segments are non-empty runs of consecutive main requests, in order, and every main request is in exactly one",
    { roled: Generated.mainConversation },
    ({ roled }) =>
      Effect.sync(() => {
        const segments = segmentsOf(roled);

        expect(
          segments.filter(({ requests }) => requests.length === 0),
        ).toEqual([]);
        expect(segments.map(({ index }) => index)).toEqual(
          segments.map((_, index) => index),
        );
        expect(segments.flatMap(({ requests }) => idsOf(requests))).toEqual(
          idsOf(mainOf(roled)),
        );
      }),
    { arbitrary: { runs: 300 } },
  );

  it.effect.prop(
    "T5: a segment begins at a main request other than the first exactly when the compaction or the size rule holds for it",
    { roled: Generated.mainConversation },
    ({ roled }) =>
      Effect.sync(() => {
        const segments = segmentsOf(roled);
        const walked = segments.flatMap(({ requests }, index) =>
          requests.map((request, at) => {
            const current =
              at === 0
                ? (segments[index - 1]?.requests ?? [])
                : requests.slice(0, at);
            const previous = Option.getOrUndefined(
              current.map(sizeOf).findLast(Option.isSome) ?? Option.none(),
            );
            const size = Option.getOrUndefined(sizeOf(request));
            const before = current.at(-1);
            const compactionRule =
              before !== undefined && before.outcome === "ok" && named(before);
            const sizeRule =
              !named(request) &&
              size !== undefined &&
              previous !== undefined &&
              2 * size < previous;
            return {
              id: request.id,
              begins: at === 0,
              rules: compactionRule || sizeRule,
              startedBy: compactionRule ? "compaction" : "size",
              said: segments[index]?.startedBy,
            };
          }),
        );

        expect(
          walked.slice(1).filter(({ begins, rules }) => begins !== rules),
        ).toEqual([]);
        expect(
          walked
            .slice(1)
            .filter(
              ({ begins, startedBy, said }) => begins && startedBy !== said,
            ),
        ).toEqual([]);
      }),
    { arbitrary: { runs: 300 } },
  );

  it.effect.prop(
    "T6: within a segment, no ok request with a prompt size but a compaction its client named has one under half of the previous such request's",
    { roled: Generated.mainConversation },
    ({ roled }) =>
      Effect.sync(() => {
        const drops = segmentsOf(roled).flatMap(({ requests }) => {
          const sized = requests.flatMap((request) =>
            Option.toArray(
              Option.map(sizeOf(request), (size) => ({ request, size })),
            ),
          );
          return sized.flatMap(({ request, size }, at) => {
            const previous = sized[at - 1]?.size;
            return previous !== undefined &&
              !named(request) &&
              2 * size < previous
              ? [{ previous, size }]
              : [];
          });
        });

        expect(drops).toEqual([]);
      }),
    { arbitrary: { runs: 300 } },
  );

  it.effect.prop(
    "T7: a segment's tip is its last ok request, or its last request when none is ok",
    { roled: Generated.mainConversation },
    ({ roled }) =>
      Effect.sync(() => {
        const segments = segmentsOf(roled);

        expect(segments.map(({ tip }) => tip.id)).toEqual(
          segments.map(({ requests }) => {
            const ok = requests.filter(({ outcome }) => outcome === "ok");
            return (ok[ok.length - 1] ?? requests[requests.length - 1])?.id;
          }),
        );
      }),
    { arbitrary: { runs: 300 } },
  );
});
