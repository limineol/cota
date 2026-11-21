import { Result, Schema } from "effect";

/** A hub's address as `cota` keeps it: `http` or `https`, a host and maybe a port, and nothing else. */
export const HubAddress = Schema.String.pipe(Schema.brand("HubAddress"));
export type HubAddress = typeof HubAddress.Type;

const ipv4Loopback = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** Whether a host, as a URL gives it (an IPv6 address in brackets), is this machine: `localhost`, `127.0.0.0/8` or `::1`. */
export const isLoopback = (host: string): boolean =>
  host === "localhost" || host === "[::1]" || ipv4Loopback.test(host);

/**
 * Reads a hub's address: `http` or `https`, with no user information, path,
 * query or fragment, and `http` only to a loopback host unless plain `http`
 * is allowed, since every request then carries a hub key in the clear. The
 * address kept is the URL's origin; a problem is a sentence that repeats no
 * user information.
 */
export const read = (
  written: string,
  allowPlainHttp: boolean,
): Result.Result<HubAddress, string> => {
  const url = URL.parse(written);
  if (url === null) {
    return Result.fail(
      "the hub's address does not read as one: write it as https://<host> or http://<host>:<port>",
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return Result.fail(
      `the hub's address is ${url.protocol.slice(0, -1)}, not http or https`,
    );
  }
  if (url.username !== "" || url.password !== "") {
    return Result.fail(
      `${url.host} is given with a user name or password, which an address keeps in the clear: give the address alone`,
    );
  }
  if (
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return Result.fail(
      `the hub's address has a path, a query or a fragment: give ${url.origin} alone`,
    );
  }
  if (
    url.protocol === "http:" &&
    !allowPlainHttp &&
    !isLoopback(url.hostname)
  ) {
    return Result.fail(
      `${url.origin} is plain http to another machine, which sends every hub key in the clear: use https, or allow it with --allow-plain-http`,
    );
  }
  return Result.succeed(HubAddress.make(url.origin));
};
