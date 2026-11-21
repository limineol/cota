import { Option, Schema } from "effect";

/** Where a passkey lives: the origin a browser makes and uses it at, and that origin's host name, its relying party ID. */
export interface RelyingParty {
  readonly id: string;
  readonly origin: string;
}

/** How the platform's URL writes an IPv4 address, whichever way it was given. */
const ipv4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

const isAddress = (hostname: string): boolean =>
  ipv4.test(hostname) || hostname.startsWith("[");

/**
 * The relying party of a request's `Origin`, as a browser would offer a
 * passkey there: the origin and its host name, when it is https at a host
 * name that is not an IP address, or localhost over http or https at any
 * port; none for any other origin, or none (I14).
 */
export const of = (origin: string | undefined): Option.Option<RelyingParty> => {
  if (origin === undefined || !URL.canParse(origin)) return Option.none();
  const url = new URL(origin);
  const web = url.protocol === "https:" || url.protocol === "http:";
  const onLocalhost = web && url.hostname === "localhost";
  const atAHostName = url.protocol === "https:" && !isAddress(url.hostname);
  if (!onLocalhost && !atAHostName) return Option.none();
  return Option.some({ id: url.hostname, origin: url.origin });
};

export class NotAPasskeyOrigin extends Schema.TaggedError<
  NotAPasskeyOrigin,
  { readonly brand: unique symbol }
>()("NotAPasskeyOrigin", { origin: Schema.optional(Schema.String) }) {}
