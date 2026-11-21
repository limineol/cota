import { Duration } from "effect";
import { type HttpServerRequest, HttpServerResponse } from "effect/http";
import { lifetime } from "#modules/sign-in/03-domain/sign-in.entity.ts";

/** The cookie that carries a browser's sign-in token. */
export const name = "cota_sign_in";

/** How many `cota_sign_in` values of one request the hub tries. */
export const mostTried = 5;

/**
 * The request's `cota_sign_in` values, in its order, the first `mostTried`.
 * A browser sends every cookie of that name its sites set, the one with the
 * longest path first, so the hub's own may follow cookies another site under
 * the same domain planted.
 */
export const tokensOf = (
  request: HttpServerRequest.HttpServerRequest,
): ReadonlyArray<string> =>
  (request.headers.cookie ?? "")
    .split(";")
    .flatMap((pair) => {
      const at = pair.indexOf("=");
      return at !== -1 && pair.slice(0, at).trim() === name
        ? [pair.slice(at + 1).trim()]
        : [];
    })
    .filter((token) => token !== "")
    .slice(0, mostTried);

/** Whether the request reached the hub over HTTPS, directly or through the owner's reverse proxy. */
const overHttps = (request: HttpServerRequest.HttpServerRequest): boolean =>
  request.originalUrl.startsWith("https:") ||
  request.headers["x-forwarded-proto"]?.split(",")[0]?.trim().toLowerCase() ===
    "https";

const cookie = (
  request: HttpServerRequest.HttpServerRequest,
  value: string,
  maxAge: Duration.Duration,
) =>
  HttpServerResponse.empty({ status: 204 }).pipe(
    HttpServerResponse.setCookieUnsafe(name, value, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      maxAge,
      secure: overHttps(request),
    }),
  );

/** An answer of 204 that gives the browser its sign-in token. */
export const given = (
  request: HttpServerRequest.HttpServerRequest,
  token: string,
) => cookie(request, token, lifetime);

/** An answer of 204 that clears the browser's sign-in token. */
export const cleared = (request: HttpServerRequest.HttpServerRequest) =>
  cookie(request, "", Duration.zero);
