import { afterAll, describe, expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import * as BuiltDashboard from "#modules/dashboard/05-tests/built-dashboard.ts";
import * as Harness from "#shared/05-tests/harness.ts";

const scratch = BuiltDashboard.make();
afterAll(scratch.remove);

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

describe("dashboard routes", () => {
  layer(Harness.layer({ dashboard: scratch.dashboard }))("built", (it) => {
    it.effect(
      "serves each built file with the content type of its extension",
      () =>
        Effect.gen(function* () {
          const answers = [];
          for (const path of [
            "/",
            "/index.html",
            "/theme.js",
            "/assets/index-0xC89QOu.js",
            "/assets/index-C7ncvV74.css",
            "/assets/geist-latin-wght-normal-BgDaEnEv.woff2",
          ]) {
            const { status, contentType, body } = yield* answerTo(path);
            answers.push([path, status, contentType, body]);
          }
          expect(answers).toEqual([
            ["/", 200, "text/html; charset=utf-8", BuiltDashboard.index],
            [
              "/index.html",
              200,
              "text/html; charset=utf-8",
              BuiltDashboard.index,
            ],
            [
              "/theme.js",
              200,
              "text/javascript; charset=utf-8",
              BuiltDashboard.files["/theme.js"],
            ],
            [
              "/assets/index-0xC89QOu.js",
              200,
              "text/javascript; charset=utf-8",
              BuiltDashboard.files["/assets/index-0xC89QOu.js"],
            ],
            [
              "/assets/index-C7ncvV74.css",
              200,
              "text/css; charset=utf-8",
              BuiltDashboard.files["/assets/index-C7ncvV74.css"],
            ],
            [
              "/assets/geist-latin-wght-normal-BgDaEnEv.woff2",
              200,
              "font/woff2",
              "wOF2",
            ],
          ]);
        }),
    );

    it.effect(
      "answers the index to a screen's path, with its query, so a reload of /sessions/abc works",
      () =>
        Effect.gen(function* () {
          expect(yield* answerTo("/sessions/abc?tab=transcript")).toEqual({
            status: 200,
            contentType: "text/html; charset=utf-8",
            cacheControl: "no-cache",
            body: BuiltDashboard.index,
          });
        }),
    );

    it.effect(
      "answers 404, not the index, to a path that names a file the build does not have",
      () =>
        Effect.gen(function* () {
          const answers = [];
          for (const path of [
            "/missing.js",
            "/sessions/abc.png",
            "/assets/index-missing.js",
            "/assets/nothing",
            "/assets/",
          ]) {
            const { status, body } = yield* answerTo(path);
            answers.push([path, status, body]);
          }
          expect(answers).toEqual([
            ["/missing.js", 404, ""],
            ["/sessions/abc.png", 404, ""],
            ["/assets/index-missing.js", 404, ""],
            ["/assets/nothing", 404, ""],
            ["/assets/", 404, ""],
          ]);
        }),
    );

    it.effect("answers HEAD with the headers GET answers and no body", () =>
      Effect.gen(function* () {
        const answers = [];
        for (const path of [
          "/",
          "/sessions/abc",
          "/assets/index-0xC89QOu.js",
        ]) {
          answers.push(yield* answerTo(path, { method: "HEAD" }));
        }
        expect(answers).toEqual([
          {
            status: 200,
            contentType: "text/html; charset=utf-8",
            cacheControl: "no-cache",
            body: "",
          },
          {
            status: 200,
            contentType: "text/html; charset=utf-8",
            cacheControl: "no-cache",
            body: "",
          },
          {
            status: 200,
            contentType: "text/javascript; charset=utf-8",
            cacheControl: "public, max-age=31536000, immutable",
            body: "",
          },
        ]);
      }),
    );

    it.effect(
      "answers a path under /api that is no endpoint as before: 404 with no body",
      () =>
        Effect.gen(function* () {
          expect(yield* answerTo("/api/nothing-here")).toEqual({
            status: 404,
            contentType: null,
            cacheControl: null,
            body: "",
          });
        }),
    );

    it.effect("answers a method other than GET and HEAD with 404", () =>
      Effect.gen(function* () {
        const { status, body } = yield* answerTo("/sessions/abc", {
          method: "POST",
        });
        expect([status, body]).toEqual([404, ""]);
      }),
    );
  });

  layer(Harness.layer())("not built", (it) => {
    it.effect(
      "answers 404 to every page, says so once at start with how to build it, and answers the API and the relay as before",
      () =>
        Effect.gen(function* () {
          const logs = yield* Harness.Logs;
          const said = logs
            .lines()
            .filter((line) => line.includes("the dashboard is not built"));
          const page = yield* answerTo("/sessions/abc");
          const health = yield* answerTo("/health");
          const relay = yield* answerTo("/pools/nowhere/v1/models", {
            headers: { "x-cota-key": Harness.secrets.clientsHubKey },
          });
          expect({
            said: said.length,
            howToBuild: said.every((line) =>
              line.includes("bun run web:build"),
            ),
            page: [page.status, page.body],
            health: [health.status, health.body],
            relay: [relay.status, JSON.parse(relay.body).error.type],
          }).toEqual({
            said: 1,
            howToBuild: true,
            page: [404, ""],
            health: [200, '{"status":"ok"}'],
            relay: [404, "cota_unknown_pool"],
          });
        }),
    );
  });

  layer(Harness.layer({ dashboard: scratch.unbuilt }))(
    "without its index",
    (it) => {
      it.effect(
        "is not built: a folder without index.html serves none of its files",
        () =>
          Effect.gen(function* () {
            const answers = [];
            for (const path of [
              "/",
              "/theme.js",
              "/assets/index-0xC89QOu.js",
            ]) {
              const { status, body } = yield* answerTo(path);
              answers.push([status, body]);
            }
            expect(answers).toEqual([
              [404, ""],
              [404, ""],
              [404, ""],
            ]);
          }),
      );
    },
  );
});
