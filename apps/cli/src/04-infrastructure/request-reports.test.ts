import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { Effect, type Layer, Redacted, Result } from "effect";
import { RequestReports } from "#02-application/interfaces/request-reports.ts";
import * as HubAddress from "#03-domain/hub-address.ts";
import * as CurlRequestReports from "./curl-request-reports.ts";
import * as HttpRequestReports from "./http-request-reports.ts";

const scratch = mkdtempSync(join(tmpdir(), "cota-request-reports-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Where a redirect would send a report: it counts what reaches it. */
const elsewhere = { reached: 0 };
const away = Bun.serve({
  port: 0,
  fetch: () => {
    elsewhere.reached += 1;
    return Response.json({ stored: 1, held: 0 });
  },
});
const redirecting = Bun.serve({
  port: 0,
  fetch: () =>
    new Response(null, {
      status: 307,
      headers: {
        location: `http://127.0.0.1:${away.port}/api/reported-requests`,
      },
    }),
});
const storing = Bun.serve({
  port: 0,
  fetch: () => Response.json({ stored: 2, held: 1 }),
});
afterAll(() => {
  away.stop(true);
  redirecting.stop(true);
  storing.stop(true);
});

const hubOf = (port: number) =>
  Result.getOrThrow(HubAddress.read(`http://127.0.0.1:${port}`, true));

const sent = (layer: Layer.Layer<RequestReports>, port: number) =>
  Effect.gen(function* () {
    const reports = yield* RequestReports;
    return yield* Effect.result(
      reports.send(
        hubOf(port),
        Redacted.make("subscription-hub-key"),
        "studio",
        '{"client":"antigravity","pool":"gemini","through":null,"calls":[]}',
        join(scratch, "state"),
      ),
    );
  }).pipe(Effect.provide(layer));

const curl = "/usr/bin/curl";

describe("a report's sender", () => {
  it.effect(
    "answers a redirect as a failed send, and sends nothing where it points",
    () =>
      Effect.gen(function* () {
        const answer = yield* sent(HttpRequestReports.layer, redirecting.port);
        expect(answer._tag === "Failure" && answer.failure._tag).toBe(
          "HubFailed",
        );
        expect(elsewhere.reached).toBe(0);
      }),
  );

  it.effect.skipIf(!existsSync(curl))(
    "through curl, reads no .curlrc of the user's, so that one that prints headers or follows redirects changes nothing",
    () =>
      Effect.gen(function* () {
        const home = mkdtempSync(join(scratch, "curl-home-"));
        writeFileSync(join(home, ".curlrc"), "include\nlocation\n");
        const before = process.env.CURL_HOME;
        process.env.CURL_HOME = home;
        try {
          const layer = CurlRequestReports.layer(curl);
          expect(yield* sent(layer, storing.port)).toEqual(
            Result.succeed({ stored: 2, held: 1 }),
          );
          const redirected = yield* sent(layer, redirecting.port);
          expect(redirected._tag === "Failure" && redirected.failure._tag).toBe(
            "HubFailed",
          );
          expect(elsewhere.reached).toBe(0);
        } finally {
          if (before === undefined) delete process.env.CURL_HOME;
          else process.env.CURL_HOME = before;
        }
      }),
  );
});
