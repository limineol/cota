import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Schema } from "effect";
import { readUserAgent, userAgentInWords } from "./user-agent.ts";

const int = (minimum: number, maximum: number) =>
  Arbitrary.schema(Schema.Int.check(Schema.isBetween({ minimum, maximum })));

const pick = <A>(values: ReadonlyArray<A>) =>
  int(0, values.length - 1).pipe(Arbitrary.map((index) => values[index] as A));

/** What a browser writes in the parentheses after `Mozilla/5.0`, and the system it is. */
const platforms: ReadonlyArray<readonly [string, string | null]> = [
  ["Windows NT 10.0; Win64; x64", "Windows"],
  ["Macintosh; Intel Mac OS X 10_15_7", "macOS"],
  ["X11; Linux x86_64", "Linux"],
  ["X11; Ubuntu; Linux x86_64; rv:120.0", "Linux"],
  ["Linux; Android 14; Pixel 8", "Android"],
  ["Linux; Android 13; SM-S918B", "Android"],
  ["iPhone; CPU iPhone OS 17_1 like Mac OS X", "iOS"],
  ["iPad; CPU OS 17_1 like Mac OS X", "iOS"],
  ["X11; CrOS x86_64 15633.69.0", "ChromeOS"],
  ["X11; FreeBSD amd64", null],
];

/** What a browser writes after its platform, and the browser it is. */
const products: ReadonlyArray<readonly [string, string | null]> = [
  [
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Chrome",
  ],
  [
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    "Chrome",
  ],
  [
    "AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1",
    "Chrome",
  ],
  [
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91",
    "Edge",
  ],
  [
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 EdgA/120.0.2210.84",
    "Edge",
  ],
  [
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/120.2210.79 Mobile/15E148 Safari/605.1.15",
    "Edge",
  ],
  [
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 OPR/106.0.0.0",
    "Opera",
  ],
  [
    "AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36",
    "Samsung Internet",
  ],
  ["Gecko/20100101 Firefox/120.0", "Firefox"],
  [
    "AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/120.0 Mobile/15E148 Safari/605.1.15",
    "Firefox",
  ],
  [
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15",
    "Safari",
  ],
  [
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1",
    "Safari",
  ],
  ["AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148", null],
];

/** Programs that are no browser, and say no system. */
const programs = ["curl/8.4.0", "Bun/1.4.2", "node", "", "Go-http-client/1.1"];

const userAgent = Arbitrary.all({
  platform: pick(platforms),
  product: pick(products),
  program: pick(programs),
  browser: Arbitrary.schema(Schema.Boolean),
}).pipe(
  Arbitrary.map(({ platform, product, program, browser }) =>
    browser
      ? {
          userAgent: `Mozilla/5.0 (${platform[0]}) ${product[0]}`,
          system: platform[1],
          browser: product[1],
          script: false,
        }
      : {
          userAgent: program === "" ? "cota quota:connect" : program,
          system: null,
          browser: null,
          script: program === "",
        },
  ),
);

const wordsOf = (browser: string | null, system: string | null) => {
  if (browser !== null && system !== null) return `${browser} on ${system}`;
  if (browser !== null) return browser;
  if (system !== null) return `A browser on ${system}`;
  return null;
};

describe("a user agent in words", () => {
  it.prop(
    "V36: a user agent is named by the first browser and the first system of the lists whose mark it holds, and by none whose mark it lacks; the connect script is named as itself",
    { sample: userAgent },
    ({ sample }) => {
      if (sample.script) {
        expect(userAgentInWords(sample.userAgent)).toBe(
          "The quota:connect script",
        );
        return;
      }
      expect(readUserAgent(sample.userAgent)).toEqual({
        browser: sample.browser,
        system: sample.system,
      });
      expect(userAgentInWords(sample.userAgent)).toBe(
        wordsOf(sample.browser, sample.system),
      );
    },
  );
});
