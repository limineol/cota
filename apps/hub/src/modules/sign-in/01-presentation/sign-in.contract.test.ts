import { expect, layer } from "@effect/vitest";
import { DateTime, Effect } from "effect";
import { TestClock } from "effect/testing";
import * as Authenticator from "#modules/sign-in/05-tests/software-authenticator.ts";
import * as Harness from "#shared/05-tests/harness.ts";

const reader = { "x-cota-key": Harness.secrets.readerHubKey };
const firefox = "Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Firefox/150.0";

const cookieAttributes = (response: Response) =>
  (response.headers.get("set-cookie") ?? "").split("; ").slice(1);

const meOf = (headers: Record<string, string>) =>
  Effect.gen(function* () {
    const client = yield* Harness.api(headers);
    return yield* client["sign-in"].me();
  });

layer(Harness.layer())("the sign-in group", (it) => {
  it.effect(
    "signs the owner in with a cookie the browser keeps for 30 days, over HTTP only",
    () =>
      Effect.gen(function* () {
        const answer = yield* Harness.sendSignIn(Harness.secrets.ownerPassword);
        expect([
          answer.status,
          yield* Harness.textOf(answer),
          answer.headers.get("set-cookie")?.match(/^cota_sign_in=[\w-]{43};/)
            ?.length,
          cookieAttributes(answer),
        ]).toEqual([
          204,
          "",
          1,
          ["Max-Age=2592000", "Path=/", "HttpOnly", "SameSite=Strict"],
        ]);
      }),
  );

  it.effect(
    "marks the cookie Secure when the owner's reverse proxy says the request came over HTTPS",
    () =>
      Effect.gen(function* () {
        const answer = yield* Harness.sendSignIn(
          Harness.secrets.ownerPassword,
          { "x-forwarded-proto": "https" },
        );
        expect(cookieAttributes(answer)).toEqual([
          "Max-Age=2592000",
          "Path=/",
          "HttpOnly",
          "Secure",
          "SameSite=Strict",
        ]);
      }),
  );

  it.effect(
    "H2: signs the owner in and tells them who they are, through the typed client",
    () =>
      Effect.gen(function* () {
        const client = yield* Harness.api();
        const [, signedIn] = yield* client["sign-in"].signIn({
          payload: { password: Harness.secrets.ownerPassword },
          responseMode: "decoded-and-response",
        });
        const cookie = signedIn.headers["set-cookie"]?.split(";")[0] ?? "";
        const me = yield* meOf({ cookie });
        expect({
          ...me,
          signIn: me.signIn && {
            createdAt: me.signIn.createdAt.toJSON(),
            expiresAt: me.signIn.expiresAt.toJSON(),
          },
        }).toEqual({
          caller: "owner",
          hubKey: null,
          signIn: {
            createdAt: "2026-11-12T00:00:00.000Z",
            expiresAt: "2026-12-12T00:00:00.000Z",
          },
        });
      }),
  );

  it.effect(
    "tells a reader key who it is, in x-cota-key or as the bearer token",
    () =>
      Effect.gen(function* () {
        expect([
          yield* meOf(reader),
          yield* meOf({
            authorization: `Bearer ${Harness.secrets.readerHubKey}`,
          }),
        ]).toEqual([
          {
            caller: "hub-key",
            hubKey: { name: "agents", scope: "reader" },
            signIn: null,
          },
          {
            caller: "hub-key",
            hubKey: { name: "agents", scope: "reader" },
            signIn: null,
          },
        ]);
      }),
  );

  it.effect("takes the hub key beside a cookie the hub does not know", () =>
    Effect.gen(function* () {
      const me = yield* meOf({
        ...reader,
        cookie: "cota_sign_in=a-sign-in-long-revoked",
      });
      expect(me.caller).toBe("hub-key");
    }),
  );

  it.effect(
    "opens the owner's sign-in behind cookies of the same name that a sibling site planted before it",
    () =>
      Effect.gen(function* () {
        const { cookie } = yield* Harness.signIn();
        const planted = Array.from(
          { length: 4 },
          (_, at) => `cota_sign_in=planted-${at}`,
        );
        const behindFour = yield* meOf({
          cookie: [...planted, "theme=dark", cookie].join("; "),
        });
        const behindFive = yield* Harness.send("/api/me", {
          headers: {
            cookie: [...planted, "cota_sign_in=x", cookie].join("; "),
          },
        });
        expect([behindFour.caller, behindFive.status]).toEqual(["owner", 401]);
      }),
  );

  it.effect(
    "takes a JSON body whose content type has parameters or capitals",
    () =>
      Effect.gen(function* () {
        const answer = yield* Harness.send("/api/sign-in", {
          method: "POST",
          headers: { "content-type": "Application/JSON; charset=utf-8" },
          body: JSON.stringify({ password: Harness.secrets.ownerPassword }),
        });
        expect(answer.status).toBe(204);
      }),
  );

  it.effect("answers a wrong password with a 401 problem", () =>
    Effect.gen(function* () {
      const answer = yield* Harness.withTheClockRunning(
        Harness.sendSignIn("not-the-owner-password"),
      );
      expect([
        yield* Harness.problemOf(answer),
        answer.headers.has("set-cookie"),
      ]).toEqual([
        {
          status: 401,
          contentType: "application/problem+json",
          body: {
            type: "urn:cota:wrong-password",
            status: 401,
            title: "That is not the owner password.",
            detail:
              "Check it and try again: 10 wrong passwords in 10 minutes pause signing in.",
          },
        },
        false,
      ]);
    }),
  );

  it.effect(
    "counts a password's characters, not its UTF-16 units: 1,024 crabs are compared",
    () =>
      Effect.gen(function* () {
        const answer = yield* Harness.withTheClockRunning(
          Harness.sendSignIn("\u{1F980}".repeat(1024)),
        );
        expect(answer.status).toBe(401);
      }),
  );

  it.effect(
    "answers a password over 1,024 characters with a 400 that does not repeat it",
    () =>
      Effect.gen(function* () {
        const password = "p".repeat(1025);
        const answer = yield* Harness.sendSignIn(password);
        const text = yield* Harness.textOf(answer);
        expect([
          answer.status,
          text.includes(password),
          JSON.parse(text),
        ]).toEqual([
          400,
          false,
          {
            type: "about:blank",
            status: 400,
            title: "Bad Request",
            detail: "Request validation failed",
            errors: [
              {
                path: ["payload", "password"],
                message: "Expected 1 to 1024 characters",
              },
            ],
          },
        ]);
      }),
  );

  it.effect(
    "answers a body over 1 MiB with a 413 problem, and closes the connection",
    () =>
      Effect.gen(function* () {
        const answer = yield* Harness.send("/api/sign-in", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: "p".repeat(1024 * 1024) }),
        });
        expect([
          yield* Harness.problemOf(answer),
          answer.headers.get("connection"),
        ]).toEqual([
          {
            status: 413,
            contentType: "application/problem+json",
            body: {
              type: "urn:cota:body-too-large",
              status: 413,
              title: "The request body is over the API's limit.",
              detail: "The API takes a body of at most 1 MiB.",
            },
          },
          "close",
        ]);
      }),
  );

  it.effect(
    "lists the live sign-ins newest first, marking the current one, and never a token",
    () =>
      Effect.gen(function* () {
        const older = yield* Harness.signIn({ "user-agent": "curl/8.17.0" });
        const ended = yield* Harness.signIn();
        yield* Harness.send("/api/sign-out", {
          method: "POST",
          headers: ended,
        });
        yield* TestClock.adjust("1 second");
        const current = yield* Harness.signIn({ "user-agent": firefox });
        const client = yield* Harness.api(current);
        const { signIns } = yield* client["sign-in"].signIns();
        const listed = signIns.map((signIn) => ({
          createdAt: signIn.createdAt.epochMilliseconds,
          userAgent: signIn.userAgent,
          current: signIn.current,
        }));
        const newest = listed[0]?.createdAt ?? 0;
        const raw = yield* Harness.textOf(
          yield* Harness.send("/api/sign-ins", { headers: current }),
        );
        expect([
          listed.slice(0, 2),
          listed.every(
            ({ createdAt }, index) =>
              createdAt <= (listed[index - 1]?.createdAt ?? newest),
          ),
          [older, ended, current].some(({ cookie }) =>
            raw.includes(cookie.slice("cota_sign_in=".length)),
          ),
          Object.keys(signIns[0] ?? {}),
        ]).toEqual([
          [
            { createdAt: newest, userAgent: firefox, current: true },
            {
              createdAt: newest - 1000,
              userAgent: "curl/8.17.0",
              current: false,
            },
          ],
          true,
          false,
          [
            "id",
            "createdAt",
            "expiresAt",
            "lastUsedAt",
            "userAgent",
            "current",
          ],
        ]);
      }),
  );

  it.effect("signs out: the cookie is cleared and opens nothing after", () =>
    Effect.gen(function* () {
      const owner = yield* Harness.signIn();
      const answer = yield* Harness.send("/api/sign-out", {
        method: "POST",
        headers: owner,
      });
      const after = yield* Harness.send("/api/me", { headers: owner });
      expect([
        answer.status,
        answer.headers.get("set-cookie"),
        after.status,
      ]).toEqual([
        204,
        "cota_sign_in=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict",
        401,
      ]);
    }),
  );

  it.effect(
    "revokes one sign-in by id, and answers 404 for one that is not live",
    () =>
      Effect.gen(function* () {
        const owner = yield* Harness.signIn();
        const other = yield* Harness.signIn();
        const client = yield* Harness.api(other);
        const otherId = (yield* client["sign-in"].me()).signIn?.id ?? "";
        const revoke = () =>
          Harness.send(`/api/sign-ins/${otherId}`, {
            method: "DELETE",
            headers: owner,
          });
        const first = yield* revoke();
        const again = yield* revoke();
        expect([
          first.status,
          yield* Harness.problemOf(again),
          (yield* Harness.send("/api/me", { headers: other })).status,
          (yield* Harness.send("/api/me", { headers: owner })).status,
        ]).toEqual([
          204,
          {
            status: 404,
            contentType: "application/problem+json",
            body: {
              type: "urn:cota:no-such-sign-in",
              status: 404,
              title: "There is no such sign-in.",
              detail: `The hub has no live sign-in "${otherId}".`,
            },
          },
          401,
          200,
        ]);
      }),
  );

  it.effect(
    "revokes every live sign-in but the current one, and says how many",
    () =>
      Effect.gen(function* () {
        const others = [yield* Harness.signIn(), yield* Harness.signIn()];
        const current = yield* Harness.signIn();
        const client = yield* Harness.api(current);
        const { revoked } = yield* client["sign-in"].revokeOtherSignIns();
        const statuses = [];
        for (const other of others) {
          statuses.push(
            (yield* Harness.send("/api/me", { headers: other })).status,
          );
        }
        expect([
          revoked >= 2,
          statuses,
          (yield* client["sign-in"].signIns()).signIns.length,
        ]).toEqual([true, [401, 401], 1]);
      }),
  );

  it.effect(
    "refuses a signed-in request that changes something from another site, or a sibling one",
    () =>
      Effect.gen(function* () {
        const owner = yield* Harness.signIn();
        const from = (site: string) =>
          Harness.send("/api/sign-ins", {
            method: "DELETE",
            headers: { ...owner, "sec-fetch-site": site },
          });
        const crossSite = yield* from("cross-site");
        const sameSite = yield* from("same-site");
        const reading = yield* Harness.send("/api/me", {
          headers: { ...owner, "sec-fetch-site": "cross-site" },
        });
        const sameOrigin = yield* from("same-origin");
        expect([
          yield* Harness.problemOf(crossSite),
          sameSite.status,
          reading.status,
          sameOrigin.status,
        ]).toEqual([
          {
            status: 403,
            contentType: "application/problem+json",
            body: {
              type: "urn:cota:cross-site",
              status: 403,
              title:
                "A browser request from another site may not change anything.",
              detail:
                "This browser sent DELETE /api/sign-ins from another site (sec-fetch-site: cross-site).",
            },
          },
          403,
          200,
          200,
        ]);
      }),
  );

  it.effect(
    "tells a known hub key what it may not call, and never which key it sent",
    () =>
      Effect.gen(function* () {
        const answer = yield* Harness.send("/api/sign-ins", {
          headers: reader,
        });
        const problem = yield* Harness.problemOf(answer);
        expect([
          problem,
          JSON.stringify(problem).includes(Harness.secrets.readerHubKey),
        ]).toEqual([
          {
            status: 403,
            contentType: "application/problem+json",
            body: {
              type: "urn:cota:not-allowed",
              status: 403,
              title: "The caller may not call this endpoint.",
              detail:
                "A hub key of the reader scope may not call GET /api/sign-ins: only the signed-in owner may.",
            },
          },
          false,
        ]);
      }),
  );

  it.effect("leaves the pool routes as they were: no 401 there", () =>
    Effect.gen(function* () {
      const owner = yield* Harness.signIn();
      const answer = yield* Harness.send("/pools/work/v1/chat/completions", {
        method: "POST",
        headers: owner,
        body: "{}",
      });
      expect([
        answer.status,
        JSON.parse(yield* Harness.textOf(answer)),
      ]).toEqual([
        403,
        {
          type: "error",
          error: {
            type: "cota_hub_key_rejected",
            message: expect.any(String),
          },
        },
      ]);
    }),
  );
});

layer(Harness.layer())("signing in, once guessed at", (it) => {
  it.effect(
    "pauses signing in after 10 wrong passwords in 10 minutes, even for the right one, and says for how long",
    () =>
      Effect.gen(function* () {
        for (let guess = 0; guess < 10; guess++) {
          yield* Harness.withTheClockRunning(
            Harness.sendSignIn(`guess-${guess}`),
          );
        }
        const paused = yield* Harness.sendSignIn(Harness.secrets.ownerPassword);
        const retryAfter = paused.headers.get("retry-after") ?? "";
        expect([
          yield* Harness.problemOf(paused),
          Number(retryAfter) > 580 && Number(retryAfter) <= 600,
        ]).toEqual([
          {
            status: 429,
            contentType: "application/problem+json",
            body: {
              type: "urn:cota:too-many-attempts",
              status: 429,
              title: "Too many wrong passwords; signing in is paused.",
              detail: `Try again in ${retryAfter} seconds.`,
            },
          },
          true,
        ]);
      }),
  );
});

/** Ten wrong passwords sent as `init` says, each answer's status and type, then whether the owner can still sign in. */
const tenWrongThenRight = (init: (password: string) => RequestInit) =>
  Effect.gen(function* () {
    const answers: Array<string> = [];
    for (let guess = 0; guess < 10; guess++) {
      const answer = yield* Harness.withTheClockRunning(
        Harness.send("/api/sign-in", init(`guess-${guess}`)),
      );
      const text = yield* Harness.textOf(answer);
      const type = text.startsWith("{")
        ? Reflect.get(JSON.parse(text), "type")
        : text;
      answers.push(`${answer.status} ${type}`);
    }
    const right = yield* Harness.sendSignIn(Harness.secrets.ownerPassword);
    return { answers, right: right.status };
  });

layer(Harness.layer())("signing in, from a page of another site", (it) => {
  it.effect(
    "I9: a sign-in from another site, or a sibling one, is refused 403 before its password is looked at, and counts as no attempt",
    () =>
      Effect.gen(function* () {
        const crossSite = yield* tenWrongThenRight((password) => ({
          method: "POST",
          headers: {
            "content-type": "application/json",
            "sec-fetch-site": "cross-site",
          },
          body: JSON.stringify({ password }),
        }));
        const sameSite = yield* tenWrongThenRight((password) => ({
          method: "POST",
          headers: {
            "content-type": "application/json",
            "sec-fetch-site": "Same-Site",
          },
          body: JSON.stringify({ password }),
        }));
        const refused = Array.from(
          { length: 10 },
          () => "403 urn:cota:cross-site",
        );
        expect([crossSite, sameSite]).toEqual([
          { answers: refused, right: 204 },
          { answers: refused, right: 204 },
        ]);
      }),
  );
});

layer(Harness.layer())("signing in, with a body not said to be JSON", (it) => {
  it.effect(
    "I10: a sign-in whose body has no content type, or another than JSON, is refused 415 before it is decoded, and counts as no attempt",
    () =>
      Effect.gen(function* () {
        const answers: Array<{
          readonly answers: ReadonlyArray<string>;
          readonly right: number;
        }> = [];
        for (const contentType of [
          undefined,
          "text/plain;charset=UTF-8",
          "application/x-www-form-urlencoded",
          "multipart/form-data; boundary=x",
          "application/jsonp",
        ]) {
          answers.push(
            yield* tenWrongThenRight((password) => ({
              method: "POST",
              headers:
                contentType === undefined
                  ? {}
                  : { "content-type": contentType },
              body: new Blob([JSON.stringify({ password })]),
            })),
          );
        }
        expect(answers).toEqual(
          Array.from({ length: 5 }, () => ({
            answers: Array.from(
              { length: 10 },
              () => "415 urn:cota:unsupported-media-type",
            ),
            right: 204,
          })),
        );
      }),
  );
});

const setupLine = "this hub is not set up";

/** The setup code the hub printed at start, as many times as it printed one. */
const setupCodesPrinted = Effect.gen(function* () {
  const logs = yield* Harness.Logs;
  return logs
    .lines()
    .filter((line) => line.includes(setupLine))
    .map((line) => /setup code ([0-9A-Z-]+)/.exec(line)?.[1] ?? "");
});

const sendSetup = (
  code: string,
  password: string,
  headers: Record<string, string> = {},
) =>
  Harness.send("/api/setup", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ code, password }),
  });

const changePassword = (
  owner: Record<string, string>,
  current: string,
  password: string,
) =>
  Harness.send("/api/owner-password", {
    method: "PUT",
    headers: { "content-type": "application/json", ...owner },
    body: JSON.stringify({ current, password }),
  });

const chosen = "a password chosen in the browser 5d1c";
const changed = "the owner password changed 7e40";

/**
 * Ten wrong setup codes sent as `init` says, each answer's status and type,
 * then the status of a wrong one sent as a browser of the hub's own page
 * would, which is still compared.
 */
const tenWrongCodesThenOneMore = (init: (code: string) => RequestInit) =>
  Effect.gen(function* () {
    const answers: Array<string> = [];
    for (let guess = 0; guess < 10; guess++) {
      const answer = yield* Harness.withTheClockRunning(
        Harness.send("/api/setup", init(`WRONG-CODE-000${guess}`)),
      );
      const text = yield* Harness.textOf(answer);
      const type = text.startsWith("{")
        ? Reflect.get(JSON.parse(text), "type")
        : text;
      answers.push(`${answer.status} ${type}`);
    }
    const after = yield* Harness.withTheClockRunning(
      sendSetup("WRONG-CODE-0010", chosen),
    );
    return { answers, after: after.status };
  });

layer(Harness.layer({ signIn: false }))("a hub that is not set up", (it) => {
  it.effect(
    "prints one setup code in its log at start, answers every sign-in that it is not set up, and lets a reader key read",
    () =>
      Effect.gen(function* () {
        const codes = yield* setupCodesPrinted;
        const answer = yield* Harness.sendSignIn(Harness.secrets.ownerPassword);
        const client = yield* Harness.api();
        expect([
          codes.map((code) =>
            /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){2}$/.test(code),
          ),
          yield* Harness.problemOf(answer),
          yield* client["sign-in"].waysIn(),
          (yield* meOf(reader)).caller,
        ]).toEqual([
          [true],
          {
            status: 403,
            contentType: "application/problem+json",
            body: {
              type: "urn:cota:not-set-up",
              status: 403,
              title: "This hub is not set up, so nobody signs in yet.",
              detail:
                "Give POST /api/setup the setup code this hub printed in its log at start, with the owner password you choose; or set [sign_in] password in its configuration and restart it.",
            },
          },
          { setUp: false, password: false, passkey: false },
          "hub-key",
        ]);
      }),
  );

  it.effect(
    "I9: a setup from another site, or a sibling one, is refused 403 before its code is looked at, and counts as no attempt",
    () =>
      Effect.gen(function* () {
        const answers: Array<{
          readonly answers: ReadonlyArray<string>;
          readonly after: number;
        }> = [];
        for (const site of ["cross-site", "Same-Site"]) {
          answers.push(
            yield* tenWrongCodesThenOneMore((code) => ({
              method: "POST",
              headers: {
                "content-type": "application/json",
                "sec-fetch-site": site,
              },
              body: JSON.stringify({ code, password: chosen }),
            })),
          );
        }
        expect(answers).toEqual(
          Array.from({ length: 2 }, () => ({
            answers: Array.from(
              { length: 10 },
              () => "403 urn:cota:cross-site",
            ),
            after: 401,
          })),
        );
      }),
  );

  it.effect(
    "I10: a setup whose body has no content type, or another than JSON, is refused 415 before it is decoded, and counts as no attempt",
    () =>
      Effect.gen(function* () {
        const answers: Array<{
          readonly answers: ReadonlyArray<string>;
          readonly after: number;
        }> = [];
        for (const contentType of [
          undefined,
          "text/plain;charset=UTF-8",
          "application/x-www-form-urlencoded",
          "multipart/form-data; boundary=x",
          "application/jsonp",
        ]) {
          answers.push(
            yield* tenWrongCodesThenOneMore((code) => ({
              method: "POST",
              headers:
                contentType === undefined
                  ? {}
                  : { "content-type": contentType },
              body: new Blob([JSON.stringify({ code, password: chosen })]),
            })),
          );
        }
        expect(answers).toEqual(
          Array.from({ length: 5 }, () => ({
            answers: Array.from(
              { length: 10 },
              () => "415 urn:cota:unsupported-media-type",
            ),
            after: 401,
          })),
        );
      }),
  );

  it.effect(
    "answers a wrong setup code with a 401 problem a second later, and a password under 12 characters with a 400 that does not repeat it",
    () =>
      Effect.gen(function* () {
        const wrong = yield* Harness.withTheClockRunning(
          sendSetup("K7QM-2F9X-HD3P", chosen),
        );
        const short = yield* sendSetup("K7QM-2F9X-HD3P", "eleven char");
        const shortText = yield* Harness.textOf(short);
        expect([
          yield* Harness.problemOf(wrong),
          wrong.headers.has("set-cookie"),
          short.status,
          shortText.includes("eleven char"),
          JSON.parse(shortText).errors,
        ]).toEqual([
          {
            status: 401,
            contentType: "application/problem+json",
            body: {
              type: "urn:cota:wrong-setup-code",
              status: 401,
              title: "That is not this hub's setup code.",
              detail:
                "Give the code this hub printed in its log at its latest start; case, hyphens and spaces do not matter.",
            },
          },
          false,
          400,
          false,
          [
            {
              path: ["payload", "password"],
              message: "Expected 12 to 1024 characters",
            },
          ],
        ]);
      }),
  );

  it.effect(
    "sets the hub up with the code its log printed, in any case and without its hyphens, and signs the owner in",
    () =>
      Effect.gen(function* () {
        const [code = ""] = yield* setupCodesPrinted;
        const at = DateTime.formatIso(yield* DateTime.now);
        const answer = yield* sendSetup(
          code.toLowerCase().replaceAll("-", " "),
          chosen,
          { "user-agent": firefox },
        );
        const cookie = answer.headers.get("set-cookie")?.split(";")[0] ?? "";
        const client = yield* Harness.api({ cookie });
        const ownerPassword = yield* client["sign-in"].ownerPassword();
        const again = yield* sendSetup(code, chosen);
        expect([
          answer.status,
          cookieAttributes(answer),
          (yield* client["sign-in"].me()).caller,
          (yield* client["sign-in"].signIns()).signIns.map(
            ({ userAgent }) => userAgent,
          ),
          yield* client["sign-in"].waysIn(),
          ownerPassword.source,
          ownerPassword.setAt?.toJSON(),
          yield* Harness.problemOf(again),
          (yield* Harness.sendSignIn(chosen)).status,
          (yield* setupCodesPrinted).length,
        ]).toEqual([
          204,
          ["Max-Age=2592000", "Path=/", "HttpOnly", "SameSite=Strict"],
          "owner",
          [firefox],
          { setUp: true, password: true, passkey: false },
          "hub-store",
          at,
          {
            status: 409,
            contentType: "application/problem+json",
            body: {
              type: "urn:cota:already-set-up",
              status: 409,
              title: "This hub is already set up.",
              detail:
                "Its owner signs in with POST /api/sign-in; the setup code opens nothing now.",
            },
          },
          204,
          1,
        ]);
      }),
  );

  it.effect(
    "changes the stored password with the current one, ending every other sign-in and keeping the one that asked",
    () =>
      Effect.gen(function* () {
        yield* TestClock.adjust("10 minutes");
        const other = yield* signInWith(chosen);
        const owner = yield* signInWith(chosen);
        const wrong = yield* Harness.withTheClockRunning(
          changePassword(owner, "not the current password", changed),
        );
        const right = yield* changePassword(owner, chosen, changed);
        expect([
          yield* Harness.problemOf(wrong),
          right.status,
          (yield* Harness.send("/api/me", { headers: other })).status,
          (yield* Harness.send("/api/me", { headers: owner })).status,
          (yield* Harness.withTheClockRunning(Harness.sendSignIn(chosen)))
            .status,
          (yield* Harness.sendSignIn(changed)).status,
        ]).toEqual([
          {
            status: 401,
            contentType: "application/problem+json",
            body: {
              type: "urn:cota:wrong-password",
              status: 401,
              title: "That is not the owner password.",
              detail: "The current password given is not the owner password.",
            },
          },
          204,
          401,
          200,
          401,
          204,
        ]);
      }),
  );
});

/** Signs the owner in with the given password, and gives the `cookie` header that carries the sign-in. */
const signInWith = (password: string) =>
  Effect.gen(function* () {
    const answer = yield* Harness.sendSignIn(password);
    return { cookie: answer.headers.get("set-cookie")?.split(";")[0] ?? "" };
  });

layer(Harness.layer())(
  "a hub whose configuration holds the owner password",
  (it) => {
    it.effect(
      "prints no setup code, refuses setup and changing the password, and says where the password is kept",
      () =>
        Effect.gen(function* () {
          const owner = yield* Harness.signIn();
          const client = yield* Harness.api(owner);
          expect([
            (yield* setupCodesPrinted).length,
            yield* client["sign-in"].waysIn(),
            yield* client["sign-in"].ownerPassword(),
            (yield* Harness.problemOf(
              yield* sendSetup("K7QM-2F9X-HD3P", chosen),
            )).body,
            yield* Harness.problemOf(
              yield* changePassword(
                owner,
                Harness.secrets.ownerPassword,
                changed,
              ),
            ),
          ]).toEqual([
            0,
            { setUp: true, password: true, passkey: false },
            { source: "configuration", setAt: null },
            {
              type: "urn:cota:already-set-up",
              status: 409,
              title: "This hub is already set up.",
              detail:
                "Its owner signs in with POST /api/sign-in; the setup code opens nothing now.",
            },
            {
              status: 409,
              contentType: "application/problem+json",
              body: {
                type: "urn:cota:password-in-configuration",
                status: 409,
                title: "The owner password is set in the hub's configuration.",
                detail:
                  "Change [sign_in] password in the hub's configuration, and restart the hub.",
              },
            },
          ]);
        }),
    );
  },
);

const localhost = "http://localhost:5173";

const at = (origin: string, counter: number): Authenticator.Signing => ({
  origin,
  rpId: new URL(origin).hostname,
  userVerified: true,
  counter,
});

const postJson = (
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) =>
  Harness.send(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const challengeOf = (answer: Response) =>
  Effect.gen(function* () {
    const options: unknown = JSON.parse(yield* Harness.textOf(answer));
    return typeof options === "object" &&
      options !== null &&
      "challenge" in options &&
      typeof options.challenge === "string"
      ? options.challenge
      : "";
  });

/** Makes the key a passkey of the signed-in owner at the origin given, as a browser there would, and gives the hub's answer. */
const makePasskey = (
  owner: Record<string, string>,
  key: Authenticator.Key,
  origin = localhost,
) =>
  Effect.gen(function* () {
    const options = yield* postJson("/api/passkeys/options", {
      ...owner,
      origin,
    });
    const response = Authenticator.create(
      key,
      yield* challengeOf(options),
      at(origin, 0),
    );
    return yield* postJson(
      "/api/passkeys",
      { ...owner, origin, "user-agent": firefox },
      response,
    );
  });

/** Signs in with the key, as a browser at the origin given would, with the signing given, and gives the hub's answer. */
const signInWithPasskey = (
  key: Authenticator.Key,
  signing: Authenticator.Signing,
  headers: Record<string, string> = {},
) =>
  Effect.gen(function* () {
    const options = yield* postJson("/api/sign-in/passkey/options", {
      origin: signing.origin,
      ...headers,
    });
    const response = yield* Authenticator.get({
      credentialId: key.credentialId,
      signer: key,
      challenge: yield* challengeOf(options),
      signing,
    });
    return yield* postJson(
      "/api/sign-in/passkey",
      { origin: signing.origin, "user-agent": firefox, ...headers },
      response,
    );
  });

const passkeyIdOf = (answer: Response) =>
  Effect.gen(function* () {
    const made: unknown = JSON.parse(yield* Harness.textOf(answer));
    return typeof made === "object" &&
      made !== null &&
      "id" in made &&
      typeof made.id === "string"
      ? made.id
      : "";
  });

const passkeyRefused = {
  status: 401,
  contentType: "application/problem+json",
  body: {
    type: "urn:cota:passkey-refused",
    status: 401,
    title: "That passkey did not sign in.",
    detail:
      "Ask POST /api/sign-in/passkey/options again, and answer it once, within 5 minutes, with a passkey this hub keeps, made at this address.",
  },
};

layer(Harness.layer())("passkeys", (it) => {
  it.effect(
    "makes a passkey at the origin the browser sent, lists it, signs in with it, and removes it",
    () =>
      Effect.gen(function* () {
        const owner = yield* Harness.signIn();
        const client = yield* Harness.api(owner);
        const key = yield* Authenticator.makeKey;
        const made = yield* makePasskey(owner, key);
        const id = yield* passkeyIdOf(made);
        const listed = yield* client["sign-in"].passkeys();
        const signedIn = yield* signInWithPasskey(key, at(localhost, 1));
        const cookie = signedIn.headers.get("set-cookie")?.split(";")[0] ?? "";
        const waysIn = yield* client["sign-in"].waysIn();
        const afterSigningIn = yield* client["sign-in"].passkeys();
        const removed = yield* Harness.send(`/api/passkeys/${id}`, {
          method: "DELETE",
          headers: owner,
        });
        const again = yield* Harness.send(`/api/passkeys/${id}`, {
          method: "DELETE",
          headers: owner,
        });
        expect([
          made.status,
          listed.passkeys.map(({ userAgent, origin, lastUsedAt }) => ({
            userAgent,
            origin,
            lastUsedAt,
          })),
          signedIn.status,
          cookieAttributes(signedIn),
          (yield* meOf({ cookie })).caller,
          waysIn,
          afterSigningIn.passkeys.map(({ lastUsedAt }) => lastUsedAt !== null),
          removed.status,
          yield* Harness.problemOf(again),
          (yield* client["sign-in"].passkeys()).passkeys,
          (yield* client["sign-in"].waysIn()).passkey,
        ]).toEqual([
          200,
          [{ userAgent: firefox, origin: localhost, lastUsedAt: null }],
          204,
          ["Max-Age=2592000", "Path=/", "HttpOnly", "SameSite=Strict"],
          "owner",
          { setUp: true, password: true, passkey: true },
          [true],
          204,
          {
            status: 404,
            contentType: "application/problem+json",
            body: {
              type: "urn:cota:no-such-passkey",
              status: 404,
              title: "There is no such passkey.",
              detail: `The hub keeps no passkey "${id}".`,
            },
          },
          [],
          false,
        ]);
      }),
  );

  it.effect(
    "refuses to make or use a passkey at an origin no browser offers one at, or with no origin, saying what a browser needs",
    () =>
      Effect.gen(function* () {
        const owner = yield* Harness.signIn();
        const answers = [];
        for (const origin of [
          "http://cota.example.com",
          "https://192.168.1.20:8443",
          "https://[::1]",
        ]) {
          answers.push(
            yield* Harness.problemOf(
              yield* postJson("/api/passkeys/options", { ...owner, origin }),
            ),
          );
        }
        const noOrigin = yield* Harness.problemOf(
          yield* postJson("/api/sign-in/passkey/options", {}),
        );
        const where =
          "A browser offers a passkey only to a page served over https at a host name, or on localhost.";
        const problem = (detail: string) => ({
          status: 400,
          contentType: "application/problem+json",
          body: {
            type: "urn:cota:not-a-passkey-origin",
            status: 400,
            title: "A browser offers no passkey at this request's origin.",
            detail,
          },
        });
        expect([...answers, noOrigin]).toEqual([
          problem(
            `This request's Origin is "http://cota.example.com". ${where}`,
          ),
          problem(
            `This request's Origin is "https://192.168.1.20:8443". ${where}`,
          ),
          problem(`This request's Origin is "https://[::1]". ${where}`),
          problem(`This request has no Origin. ${where}`),
        ]);
      }),
  );

  it.effect(
    "answers a passkey sign-in on a hub with no passkey with a 409, and every failed one with the same 401, whichever check failed",
    () =>
      Effect.gen(function* () {
        const none = yield* Harness.problemOf(
          yield* postJson("/api/sign-in/passkey/options", {
            origin: localhost,
          }),
        );
        const owner = yield* Harness.signIn();
        const key = yield* Authenticator.makeKey;
        const stranger = yield* Authenticator.makeKey;
        yield* makePasskey(owner, key);
        const unverified = yield* signInWithPasskey(key, {
          ...at(localhost, 1),
          userVerified: false,
        });
        const unknown = yield* signInWithPasskey(stranger, at(localhost, 1));
        const elsewhere = yield* signInWithPasskey(
          key,
          at("https://cota.example.com", 2),
        );
        expect([
          none,
          yield* Harness.problemOf(unverified),
          yield* Harness.problemOf(unknown),
          yield* Harness.problemOf(elsewhere),
          (yield* signInWithPasskey(key, at(localhost, 3))).status,
        ]).toEqual([
          {
            status: 409,
            contentType: "application/problem+json",
            body: {
              type: "urn:cota:no-passkeys",
              status: 409,
              title: "This hub has no passkey to sign in with.",
              detail:
                "Sign in with the owner password; a signed-in owner makes a passkey with POST /api/passkeys/options and POST /api/passkeys.",
            },
          },
          passkeyRefused,
          passkeyRefused,
          passkeyRefused,
          204,
        ]);
      }),
  );

  it.effect(
    "refuses a passkey sign-in from another site, or a sibling one, before it is looked at",
    () =>
      Effect.gen(function* () {
        const owner = yield* Harness.signIn();
        const key = yield* Authenticator.makeKey;
        yield* makePasskey(owner, key);
        const answers: Array<unknown> = [];
        for (const site of ["cross-site", "same-site"]) {
          answers.push(
            (yield* Harness.problemOf(
              yield* postJson("/api/sign-in/passkey/options", {
                origin: localhost,
                "sec-fetch-site": site,
              }),
            )).body,
          );
          const response = yield* Authenticator.get({
            credentialId: key.credentialId,
            signer: key,
            challenge: yield* challengeOf(
              yield* postJson("/api/sign-in/passkey/options", {
                origin: localhost,
              }),
            ),
            signing: at(localhost, answers.length),
          });
          answers.push(
            (yield* Harness.problemOf(
              yield* postJson(
                "/api/sign-in/passkey",
                { origin: localhost, "sec-fetch-site": site },
                response,
              ),
            )).body,
          );
        }
        expect(
          answers.map((body) => Reflect.get(Object(body), "type")),
        ).toEqual(Array.from({ length: 4 }, () => "urn:cota:cross-site"));
      }),
  );
});

layer(Harness.layer({ signIn: false }))(
  "turning the password off and on",
  (it) => {
    it.effect(
      "forgets the stored password while a passkey remains, signs in with the passkey alone, and never removes the last way in",
      () =>
        Effect.gen(function* () {
          const [code = ""] = yield* setupCodesPrinted;
          const owner = {
            cookie:
              (yield* sendSetup(code, chosen)).headers
                .get("set-cookie")
                ?.split(";")[0] ?? "",
          };
          const client = yield* Harness.api(owner);
          const key = yield* Authenticator.makeKey;
          const id = yield* passkeyIdOf(yield* makePasskey(owner, key));
          const forgotten = yield* Harness.send("/api/owner-password", {
            method: "DELETE",
            headers: owner,
          });
          const source = (yield* client["sign-in"].ownerPassword()).source;
          const passwordOff = yield* Harness.problemOf(
            yield* Harness.sendSignIn(chosen),
          );
          const waysIn = yield* client["sign-in"].waysIn();
          const lastPasskey = yield* Harness.problemOf(
            yield* Harness.send(`/api/passkeys/${id}`, {
              method: "DELETE",
              headers: owner,
            }),
          );
          const signedIn = yield* signInWithPasskey(key, at(localhost, 1));
          const passkeySignIn = {
            cookie: signedIn.headers.get("set-cookie")?.split(";")[0] ?? "",
          };
          const set = yield* Harness.send("/api/owner-password", {
            method: "PUT",
            headers: { "content-type": "application/json", ...owner },
            body: JSON.stringify({ password: changed }),
          });
          const removed = yield* Harness.send(`/api/passkeys/${id}`, {
            method: "DELETE",
            headers: owner,
          });
          const lastPassword = yield* Harness.problemOf(
            yield* Harness.send("/api/owner-password", {
              method: "DELETE",
              headers: owner,
            }),
          );
          expect([
            forgotten.status,
            source,
            passwordOff,
            waysIn,
            lastPasskey,
            signedIn.status,
            set.status,
            (yield* Harness.send("/api/me", { headers: passkeySignIn })).status,
            removed.status,
            lastPassword,
            yield* client["sign-in"].waysIn(),
            (yield* Harness.sendSignIn(changed)).status,
          ]).toEqual([
            204,
            "none",
            {
              status: 403,
              contentType: "application/problem+json",
              body: {
                type: "urn:cota:password-off",
                status: 403,
                title:
                  "The owner password is off: the owner signs in with a passkey.",
                detail:
                  "Sign in with a passkey; or set [sign_in] password in the hub's configuration and restart it.",
              },
            },
            { setUp: true, password: false, passkey: true },
            {
              status: 409,
              contentType: "application/problem+json",
              body: {
                type: "urn:cota:last-way-in",
                status: 409,
                title: "That would leave the owner no way in.",
                detail:
                  "It is the last passkey and the hub has no owner password: set a password, or make another passkey, first.",
              },
            },
            204,
            204,
            401,
            204,
            {
              status: 409,
              contentType: "application/problem+json",
              body: {
                type: "urn:cota:last-way-in",
                status: 409,
                title: "That would leave the owner no way in.",
                detail:
                  "Make a passkey first, or set [sign_in] password in the hub's configuration: the owner signs in with the stored password alone.",
              },
            },
            { setUp: true, password: true, passkey: false },
            204,
          ]);
        }),
    );
  },
);
