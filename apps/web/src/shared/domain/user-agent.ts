/** The browser and the system a user agent names, each null when it names none the dashboard knows. */
export interface Reading {
  readonly browser: string | null;
  readonly system: string | null;
}

/** Browsers by their marks, the more particular first: Edge and Opera also write Chrome's, and Chrome writes Safari's. */
const browsers: ReadonlyArray<readonly [string, RegExp]> = [
  ["Edge", /\bEdg(?:e|A|iOS)?\//],
  ["Opera", /\b(?:OPR|OPT)\//],
  ["Samsung Internet", /\bSamsungBrowser\//],
  ["Firefox", /\b(?:Firefox|FxiOS)\//],
  ["Chrome", /\b(?:Chrome|CriOS)\//],
  ["Safari", /\bVersion\/\S+.*\bSafari\//],
];

/** Systems by their marks, the more particular first: an iPhone writes "like Mac OS X", and Android and ChromeOS write Linux. */
const systems: ReadonlyArray<readonly [string, RegExp]> = [
  ["iOS", /\b(?:iPhone|iPad|iPod)\b/],
  ["Android", /\bAndroid\b/],
  ["ChromeOS", /\bCrOS\b/],
  ["Windows", /\bWindows\b/],
  ["macOS", /\bMacintosh\b/],
  ["Linux", /\bLinux\b/],
];

const connectScript = /^cota quota:connect\b/;

const firstOf = (
  marks: ReadonlyArray<readonly [string, RegExp]>,
  userAgent: string,
) => marks.find(([, mark]) => mark.test(userAgent))?.[0] ?? null;

/** The first browser and the first system of the lists whose mark the user agent holds (V36). */
export const readUserAgent = (userAgent: string): Reading => ({
  browser: firstOf(browsers, userAgent),
  system: firstOf(systems, userAgent),
});

/**
 * A user agent in words: the connect script as itself, else `Firefox on
 * macOS`, the browser or the system alone when only one is known, and null
 * when neither is (V36).
 */
export const userAgentInWords = (userAgent: string): string | null => {
  if (connectScript.test(userAgent)) return "The quota:connect script";
  const { browser, system } = readUserAgent(userAgent);
  if (browser !== null && system !== null) return `${browser} on ${system}`;
  if (browser !== null) return browser;
  if (system !== null) return `A browser on ${system}`;
  return null;
};
