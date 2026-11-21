export type Hue = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | "neutral";

export type Tint = Hue | "ramp-1" | "ramp-2" | "ramp-3" | "ramp-4";

export const tintClass: Record<Tint, string> = {
  1: "hue-1",
  2: "hue-2",
  3: "hue-3",
  4: "hue-4",
  5: "hue-5",
  6: "hue-6",
  7: "hue-7",
  8: "hue-8",
  neutral: "hue-neutral",
  "ramp-1": "hue-ramp-1",
  "ramp-2": "hue-ramp-2",
  "ramp-3": "hue-ramp-3",
  "ramp-4": "hue-ramp-4",
};
