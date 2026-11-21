import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { mostOffset, pageOf } from "./pages.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const asked = Arbitrary.all({
  limit: Arbitrary.all({ usual: int(0, 1), other: int(1, 200) }).pipe(
    Arbitrary.map(({ usual, other }) => (usual === 1 ? 50 : other)),
  ),
  pages: int(0, 260),
  rest: int(-1, 1),
  page: int(-2, 262),
}).pipe(
  Arbitrary.map(({ limit, pages, rest, page }) => ({
    limit,
    total: Math.max(0, pages * limit + rest),
    page,
  })),
);

describe("paging", () => {
  it.prop(
    "V23: a page holds the rows from its offset on, at most the limit of them and none past the total; the pages are as many as the total needs, each following the one before, and none is offered past the last whose offset the hub takes",
    { asked },
    ({ asked: { limit, total, page } }) => {
      const shown = pageOf(page, total, limit);
      expect(shown.pages * limit).toBeGreaterThanOrEqual(total);
      expect(shown.pages === 1 || (shown.pages - 1) * limit < total).toBe(true);
      expect((shown.reachable - 1) * limit).toBeLessThanOrEqual(mostOffset);
      expect(
        shown.reachable === shown.pages || shown.reachable * limit > mostOffset,
      ).toBe(true);
      expect(shown.page).toBeGreaterThanOrEqual(1);
      expect(shown.page).toBeLessThanOrEqual(shown.reachable);
      if (page >= 1 && page <= shown.reachable) expect(shown.page).toBe(page);
      expect(shown.offset).toBe((shown.page - 1) * limit);
      if (total > shown.offset) {
        expect(shown.first).toBe(shown.offset + 1);
        expect(shown.last).toBe(Math.min(shown.offset + limit, total));
      } else {
        expect([shown.first, shown.last]).toEqual([0, 0]);
      }
      if (shown.page < shown.reachable) {
        const next = pageOf(shown.page + 1, total, limit);
        expect(next.first).toBe(shown.last + 1);
      }
    },
  );
});
