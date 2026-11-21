import { join } from "node:path";
import { afterAll, expect, layer } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import * as BuiltDashboard from "#modules/dashboard/05-tests/built-dashboard.ts";
import * as Harness from "#shared/05-tests/harness.ts";

const scratch = BuiltDashboard.make();
afterAll(scratch.remove);

const runs = (count: number) => ({
  timeout: 30_000,
  arbitrary: { runs: count },
});

const pick = <const A extends readonly [string, ...Array<string>]>(
  values: A,
): Arbitrary.Arbitrary<A[number]> => Arbitrary.schema(Schema.Literals(values));
const text = (pattern: RegExp) =>
  Arbitrary.schema(Schema.String.check(Schema.isPattern(pattern)));
const method = pick(["GET", "HEAD"]);

const secretFile = join(scratch.parent, "secret.txt");

const climb = pick([
  "..",
  "%2e%2e",
  "%2E%2e",
  ".%2e",
  "%2e.",
  ".",
  "%2e",
  "%252e%252e",
  "..%2f..",
  "..%5c..",
  "..\\..",
  "%2f",
  "%5c",
  "%00",
  "",
  "assets",
  "dist",
]);

const target = pick([
  "secret.txt",
  "dist-twin/secret.txt",
  "dist-twin%2fsecret.txt",
  "..%2F..%2Fsecret.txt",
  "secret.txt%00.html",
  "index.html",
  encodeURIComponent(secretFile),
  secretFile.slice(1),
]);

const escapingPath = Arbitrary.all([
  pick(["", "/assets", "/assets/", "//", "/sessions"]),
  Arbitrary.array(climb, { maxLength: 3 }),
  target,
  pick(["", "?a=b", "#here"]),
]).pipe(
  Arbitrary.map(
    ([prefix, climbs, file, end]) =>
      `${prefix}${[...climbs, file].map((each) => `/${each}`).join("")}${end}`,
  ),
);

const pageSegment = text(/^[A-Za-z0-9_~-]{1,10}$/);
const pagePath = Arbitrary.all([
  pageSegment.pipe(
    Arbitrary.filter(
      (first) => !["api", "pools", "health", "assets"].includes(first),
    ),
  ),
  Arbitrary.array(pageSegment, { maxLength: 3 }),
  pick(["", "/"]),
  pick(["", "?range=7d", "?tab=transcript&pool=work"]),
]).pipe(
  Arbitrary.map(
    ([first, rest, slash, query]) =>
      `/${[first, ...rest].join("/")}${slash}${query}`,
  ),
);

const hubPath = Arbitrary.all([
  pick(["api", "pools", "health", "%61pi", "%70ools"]),
  // A client resolves "." and ".." before it asks: "/health/../" is a request for "/".
  Arbitrary.array(
    text(/^[A-Za-z0-9_.~-]{1,10}$/).pipe(
      Arbitrary.filter((segment) => segment !== "." && segment !== ".."),
    ),
    { maxLength: 3 },
  ),
  pick(["", "/"]),
]).pipe(
  Arbitrary.map(
    ([first, rest, slash]) =>
      `/${[first, ...rest].join("/")}${rest.length > 0 ? slash : ""}`,
  ),
);

const answerTo = (path: string, init: RequestInit = {}) =>
  Effect.gen(function* () {
    const response = yield* Harness.send(path, init);
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      cacheControl: response.headers.get("cache-control"),
      body: yield* Harness.textOf(response),
    };
  });

layer(Harness.layer({ dashboard: scratch.dashboard }))(
  "dashboard laws",
  (it) => {
    it.effect.prop(
      "P1: No path, however written, reads a file outside the dashboard's folder.",
      { method, path: escapingPath },
      ({ method, path }) =>
        Effect.gen(function* () {
          const answer = yield* Harness.sendRaw(
            `${method} ${path} HTTP/1.1\r\nhost: hub\r\nconnection: close\r\n\r\n`,
          );
          expect(answer).not.toContain(BuiltDashboard.outside);
        }),
      runs(300),
    );

    it.effect.prop(
      "P2: A path the build has no file for, outside the hub's own paths and without an extension, answers the index.",
      { path: pagePath },
      ({ path }) =>
        Effect.gen(function* () {
          expect(yield* answerTo(path)).toEqual({
            status: 200,
            contentType: "text/html; charset=utf-8",
            cacheControl: "no-cache",
            body: BuiltDashboard.index,
          });
        }),
      runs(100),
    );

    it.effect.prop(
      "P3: A path under /api, /pools or /health never answers the index, nor any built file.",
      { method, path: hubPath },
      ({ method, path }) =>
        Effect.gen(function* () {
          const answer = yield* answerTo(path, { method });
          expect(answer.contentType ?? "").not.toMatch(
            /^text\/(html|css)|javascript/,
          );
          expect(Object.values(BuiltDashboard.files)).not.toContain(
            answer.body,
          );
        }),
      runs(150),
    );

    it.effect.prop(
      "P4: A file under /assets is cached for a year, and the index and every other file are asked for again each time.",
      {
        method,
        path: Arbitrary.all([
          Arbitrary.schema(Schema.Boolean),
          pick([
            "/",
            "/index.html",
            "/theme.js",
            "/assets/index-0xC89QOu.js",
            "/assets/index-C7ncvV74.css",
            "/assets/geist-latin-wght-normal-BgDaEnEv.woff2",
          ]),
          pagePath,
        ]).pipe(Arbitrary.map(([built, file, page]) => (built ? file : page))),
      },
      ({ method, path }) =>
        Effect.gen(function* () {
          const { status, cacheControl } = yield* answerTo(path, { method });
          expect([status, cacheControl]).toEqual([
            200,
            path.startsWith("/assets/")
              ? "public, max-age=31536000, immutable"
              : "no-cache",
          ]);
        }),
      runs(100),
    );
  },
);
