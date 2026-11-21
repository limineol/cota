import { DateTime } from "effect";
import { cost } from "#shared/domain/quantities.ts";

const count = new Intl.NumberFormat("en-US");

export const plural = (n: number, one: string, many = `${one}s`) =>
  `${count.format(n)} ${n === 1 ? one : many}`;

export const counted = (n: number) => count.format(n);

export const millis = (at: DateTime.Utc) => DateTime.toEpochMillis(at);

const time = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
});
const dayOfMonth = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});
const dayKey = new Intl.DateTimeFormat("en-CA");

export const timeOf = (at: number) => time.format(at);

export const dayOf = (at: number) => dayOfMonth.format(at);

const sameDay = (a: number, b: number) => dayKey.format(a) === dayKey.format(b);

/** A moment in the viewer's zone: its time alone today, `Nov 15 14:05` on another day. */
export const when = (at: number, now: number) =>
  sameDay(at, now) ? timeOf(at) : `${dayOf(at)} ${timeOf(at)}`;

/** A stretch of time in the viewer's zone, its end's day written only when it is not the start's: `Nov 2 21:00 – Nov 3 21:00`. */
export const stretch = (start: number, end: number, now: number) =>
  `${when(start, now)} – ${
    sameDay(start, end) ? timeOf(end) : `${dayOf(end)} ${timeOf(end)}`
  }`;

/** A sum of dollars, never written as complete while any request in it has no price. */
export const costText = (dollars: number, unpriced: number) => {
  if (unpriced === 0) return cost(dollars);
  return dollars === 0 ? "no price" : `≥${cost(dollars)}`;
};

export const dollarsOf = (picodollars: bigint) => Number(picodollars) / 1e12;

interface Usage {
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWriteShort: number;
  readonly cacheWriteLong: number;
  readonly output: number;
}

/** Every token of a usage: input, cache reads and writes, and output, reasoning included. */
export const tokensIn = (usage: Usage) =>
  usage.input +
  usage.cacheRead +
  usage.cacheWriteShort +
  usage.cacheWriteLong +
  usage.output;

/** Every token sent to the model, cached or not. */
export const inputIn = (usage: Usage) =>
  usage.input + usage.cacheRead + usage.cacheWriteShort + usage.cacheWriteLong;

/** A request's duration: tenths of a second under a minute, then minutes and seconds. */
export const durationOf = (milliseconds: number) => {
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(1)}s`;
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
};
