const minute = 60_000;

/** A span of time in its two largest units, rounded down: `<1m`, `14m`, `2h 14m`, `5d 4h`. */
export const span = (milliseconds: number): string => {
  const minutes = Math.floor(Math.max(0, milliseconds) / minute);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
};

const magnitudes = [
  { suffix: "K", size: 1e3 },
  { suffix: "M", size: 1e6 },
  { suffix: "B", size: 1e9 },
  { suffix: "T", size: 1e12 },
] as const;

const tenths = (value: number) => Math.round(value * 10) / 10;

/** A count of tokens: whole under a thousand, else in K, M, B or T with at most one decimal: `950`, `1.2K`, `3.4M`. */
export const tokens = (count: number): string => {
  if (Math.round(count) < 1000) return String(Math.round(count));
  const fits = magnitudes.findIndex(
    ({ size }, index) =>
      index === magnitudes.length - 1 || tenths(count / size) < 1000,
  );
  const { suffix, size } = magnitudes[fits] ?? magnitudes[0];
  return `${tenths(count / size)}${suffix}`;
};

const whole = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** A cost in dollars: `$0`, `<$0.01`, cents under $100, whole dollars from there. */
export const cost = (dollars: number): string => {
  if (dollars <= 0) return "$0";
  if (dollars < 0.01) return "<$0.01";
  const cents = Math.round(dollars * 100);
  if (cents < 100 * 100) return `$${(cents / 100).toFixed(2)}`;
  return `$${whole.format(Math.round(dollars))}`;
};

/** A share of a whole, from 0 to 1, as a whole percentage that is never `0%` for a part above nothing nor `100%` for less than all. */
export const share = (fraction: number): string => {
  const percent = fraction * 100;
  if (percent > 0 && percent < 0.5) return "<1%";
  if (percent < 100 && percent >= 99.5) return "99%";
  return `${Math.round(percent)}%`;
};

export interface Delta {
  readonly direction: "up" | "down" | "none";
  readonly text: string;
}

/** How a figure changed since the window before: `none before`, `no change`, `↓40%`, `↑12%`, `↑3.4×`, `↑12×`. */
export const delta = (current: number, previous: number): Delta => {
  if (previous <= 0) {
    return {
      direction: "none",
      text: current <= 0 ? "no change" : "none before",
    };
  }
  const ratio = current / previous;
  const change = ratio - 1;
  if (Math.abs(change) < 0.005) return { direction: "none", text: "no change" };
  if (change < 0) return { direction: "down", text: `↓${share(-change)}` };
  if (ratio < 2) return { direction: "up", text: `↑${share(change)}` };
  const times =
    ratio < 10
      ? String(Math.floor(ratio * 10) / 10)
      : whole.format(Math.floor(ratio));
  return { direction: "up", text: `↑${times}×` };
};

/** How long ago something happened: `just now` under a minute, else its span, as `14m ago`. */
export const ago = (milliseconds: number): string =>
  milliseconds < minute ? "just now" : `${span(milliseconds)} ago`;
