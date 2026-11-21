import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { ago, cost, delta, share, span, tokens } from "./quantities.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const ofAnySize = (most: number) =>
  Arbitrary.all({ digits: int(0, most), value: int(0, 10 ** most) }).pipe(
    Arbitrary.map(({ digits, value }) => value % 10 ** digits),
  );

const edges = [0.01, 1, 100];
const dollars = Arbitrary.all({
  value: ofAnySize(9),
  scale: int(0, 4),
  edge: int(-1, edges.length - 1),
  offset: int(-60, 60),
}).pipe(
  Arbitrary.map(({ value, scale, edge, offset }) => {
    const near = edges[edge];
    return near === undefined
      ? value / 10 ** scale
      : Math.max(0, near + offset / 10_000);
  }),
);

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

const spanOf = (text: string) => {
  const days = text.match(/^([1-9]\d*)d (\d|1\d|2[0-3])h$/);
  if (days)
    return { said: Number(days[1]) * day + Number(days[2]) * hour, step: hour };
  const hours = text.match(/^([1-9]|1\d|2[0-3])h (\d|[1-5]\d)m$/);
  if (hours)
    return {
      said: Number(hours[1]) * hour + Number(hours[2]) * minute,
      step: minute,
    };
  const minutes = text.match(/^([1-9]|[1-5]\d)m$/);
  if (minutes) return { said: Number(minutes[1]) * minute, step: minute };
  if (text === "<1m") return { said: 0, step: minute };
  return undefined;
};

const magnitudes: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 };

describe("writing quantities", () => {
  it.prop(
    "V14: a span is written in its two largest units, rounded down, so that it never says more than the span nor less by one of its smaller unit",
    { milliseconds: ofAnySize(10) },
    ({ milliseconds }) => {
      const written = spanOf(span(milliseconds));
      expect(written).toBeDefined();
      if (written === undefined) return;
      expect(written.said).toBeLessThanOrEqual(milliseconds);
      expect(milliseconds).toBeLessThan(written.said + written.step);
    },
  );

  it.prop(
    "V15: a count of tokens under a thousand is written whole, and from there in K, M, B or T with at most one decimal, within half of that decimal",
    { count: ofAnySize(14) },
    ({ count }) => {
      const written = tokens(count);
      if (count < 1000) {
        expect(written).toBe(String(count));
        return;
      }
      const [, number = "", suffix = ""] =
        written.match(/^([1-9]\d{0,2}(?:\.[1-9])?)([KMBT])$/) ?? [];
      const size = magnitudes[suffix] ?? Number.NaN;
      expect(written).toMatch(/^[1-9]\d{0,2}(?:\.[1-9])?[KMBT]$/);
      const tenths = Math.round(Number(number) * 10);
      expect(Math.abs(tenths * (size / 10) - count)).toBeLessThanOrEqual(
        size / 20,
      );
    },
  );

  it.prop(
    "V16: a cost is $0 for nothing, <$0.01 above nothing and below a cent, within half a cent under $100 and within half a dollar from there",
    { dollars },
    ({ dollars }) => {
      const written = cost(dollars);
      if (dollars === 0) {
        expect(written).toBe("$0");
        return;
      }
      if (dollars < 0.01) {
        expect(written).toBe("<$0.01");
        return;
      }
      const cents = written.match(/^\$(\d{1,2}\.\d\d)$/);
      if (cents) {
        expect(Math.abs(Number(cents[1]) - dollars)).toBeLessThanOrEqual(
          0.005 + 1e-9,
        );
        return;
      }
      const whole = written.match(/^\$(\d{1,3}(?:,\d{3})*)$/);
      expect(whole).not.toBeNull();
      const said = Number((whole?.[1] ?? "").replaceAll(",", ""));
      expect(said).toBeGreaterThanOrEqual(100);
      expect(Math.abs(said - dollars)).toBeLessThanOrEqual(0.5);
    },
  );

  it.prop(
    "V17: a share is written as a whole percentage within half a point, except that a share above nothing is never 0% and a share below all is never 100%",
    { parts: int(0, 200_000) },
    ({ parts }) => {
      const fraction = parts / 200_000;
      const written = share(fraction);
      const percent = fraction * 100;
      if (percent > 0 && percent < 0.5) {
        expect(written).toBe("<1%");
        return;
      }
      if (percent < 100 && percent >= 99.5) {
        expect(written).toBe("99%");
        return;
      }
      const [, said = ""] = written.match(/^(\d{1,3})%$/) ?? [];
      expect(Math.abs(Number(said) - percent)).toBeLessThanOrEqual(0.5);
      if (percent > 0) expect(written).not.toBe("0%");
      if (percent < 100) expect(written).not.toBe("100%");
    },
  );

  it.prop(
    "V19: a delta is none before from nothing, no change within half a percent, a share of the previous figure below double, and a multiple rounded down from double",
    {
      drawn: ofAnySize(7),
      previous: ofAnySize(7),
      near: int(-80, 80),
      thousandths: int(0, 30_000),
      shape: int(0, 2),
    },
    ({ drawn, previous, near, thousandths, shape }) => {
      const current = [
        drawn,
        Math.max(0, previous + near),
        Math.round((previous * thousandths) / 1000),
      ][shape];
      if (current === undefined) return;
      const written = delta(current, previous);
      if (previous === 0) {
        expect(written).toEqual({
          direction: "none",
          text: current === 0 ? "no change" : "none before",
        });
        return;
      }
      const change = current / previous - 1;
      if (Math.abs(change) < 0.005) {
        expect(written).toEqual({ direction: "none", text: "no change" });
        return;
      }
      expect(written.direction).toBe(change > 0 ? "up" : "down");
      const arrow = change > 0 ? "↑" : "↓";
      if (current >= 2 * previous) {
        const [, said = ""] =
          written.text.match(/^↑(\d{1,3}(?:,\d{3})*(?:\.\d)?)×$/) ?? [];
        const times = Number(said.replaceAll(",", ""));
        const step = current < 10 * previous ? 0.1 : 1;
        expect(said).not.toBe("");
        expect(times).toBeLessThanOrEqual(current / previous);
        expect(current / previous).toBeLessThan(times + step);
        return;
      }
      expect(written.text).toBe(`${arrow}${share(Math.abs(change))}`);
    },
  );

  it.prop(
    "V20: an ago is just now under a minute, and otherwise the span it has been, followed by ago",
    { any: ofAnySize(10), recent: int(0, 10 * minute), isRecent: int(0, 1) },
    ({ any, recent, isRecent }) => {
      const milliseconds = isRecent === 1 ? recent : any;
      expect(ago(milliseconds)).toBe(
        milliseconds < minute ? "just now" : `${span(milliseconds)} ago`,
      );
    },
  );
});
