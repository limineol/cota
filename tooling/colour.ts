export type Triple = readonly [number, number, number];

export type Vision = "normal" | "protanopia" | "deuteranopia" | "tritanopia";

const linearOf = (hex: string): Triple => {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((at) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return [r, g, b];
};

const luminance = ([r, g, b]: Triple) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** WCAG 2's contrast ratio of two `#rrggbb` colours, from 1 to 21. */
export const contrast = (one: string, other: string): number => {
  const [light, dark] = [luminance(linearOf(one)), luminance(linearOf(other))]
    .sort((a, b) => b - a)
    .map((value) => value + 0.05);
  return (light ?? 1) / (dark ?? 1);
};

/** Machado, Oliveira and Fernandes (2009) at full severity, applied to linear sRGB. */
const visions: Record<Vision, ReadonlyArray<Triple>> = {
  normal: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const seenWith = (vision: Vision, [r, g, b]: Triple): Triple => {
  const [x = 0, y = 0, z = 0] = visions[vision].map(([kr, kg, kb]) =>
    Math.min(1, Math.max(0, kr * r + kg * g + kb * b)),
  );
  return [x, y, z];
};

const labOf = ([r, g, b]: Triple): Triple => {
  const f = (t: number) =>
    t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116;
  const x = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const y = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const z = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
};

const degrees = Math.PI / 180;

/** CIEDE2000, the colour difference of two CIELAB colours (Sharma, Wu and Dalal, 2005). */
export const difference = (
  [l1, a1, b1]: Triple,
  [l2, a2, b2]: Triple,
): number => {
  const chroma = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(chroma ** 7 / (chroma ** 7 + 25 ** 7)));
  const c1 = Math.hypot((1 + g) * a1, b1);
  const c2 = Math.hypot((1 + g) * a2, b2);
  const hueOf = (b: number, a: number) =>
    b === 0 && a === 0 ? 0 : (Math.atan2(b, a) / degrees + 360) % 360;
  const h1 = hueOf(b1, (1 + g) * a1);
  const h2 = hueOf(b2, (1 + g) * a2);
  const bothChromatic = c1 * c2 !== 0;
  const turn = h2 - h1;
  const dh = !bothChromatic
    ? 0
    : turn > 180
      ? turn - 360
      : turn < -180
        ? turn + 360
        : turn;
  const dH = 2 * Math.sqrt(c1 * c2) * Math.sin((dh / 2) * degrees);
  const lMean = (l1 + l2) / 2;
  const cMean = (c1 + c2) / 2;
  const hMean = !bothChromatic
    ? h1 + h2
    : Math.abs(h1 - h2) <= 180
      ? (h1 + h2) / 2
      : (h1 + h2 + (h1 + h2 < 360 ? 360 : -360)) / 2;
  const t =
    1 -
    0.17 * Math.cos((hMean - 30) * degrees) +
    0.24 * Math.cos(2 * hMean * degrees) +
    0.32 * Math.cos((3 * hMean + 6) * degrees) -
    0.2 * Math.cos((4 * hMean - 63) * degrees);
  const rotation = 30 * Math.exp(-(((hMean - 275) / 25) ** 2));
  const rc = 2 * Math.sqrt(cMean ** 7 / (cMean ** 7 + 25 ** 7));
  const sl =
    1 + (0.015 * (lMean - 50) ** 2) / Math.sqrt(20 + (lMean - 50) ** 2);
  const sc = 1 + 0.045 * cMean;
  const sh = 1 + 0.015 * cMean * t;
  const rt = -Math.sin(2 * rotation * degrees) * rc;
  const dL = (l2 - l1) / sl;
  const dC = (c2 - c1) / sc;
  const dHs = dH / sh;
  return Math.sqrt(dL ** 2 + dC ** 2 + dHs ** 2 + rt * dC * dHs);
};

/** How far apart two `#rrggbb` colours look to someone with the given vision, in CIEDE2000. */
export const apart = (vision: Vision, one: string, other: string): number =>
  difference(
    labOf(seenWith(vision, linearOf(one))),
    labOf(seenWith(vision, linearOf(other))),
  );
