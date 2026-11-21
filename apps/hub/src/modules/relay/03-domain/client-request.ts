import { Option } from "effect";
import { bearerOf } from "#shared/03-domain/bearer-token.ts";

export type Headers = Readonly<Record<string, string>>;

/** What a client sent, as its pool's protocol reads it. */
export interface ClientRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Headers;
  readonly body: Option.Option<unknown>;
}

/**
 * Gives a request's login: the bearer token of its authorization header, or
 * the header's whole value when it is not a bearer token, else its x-api-key.
 */
export const loginOf = (headers: Headers): Option.Option<string> => {
  const authorization = headers.authorization?.trim() ?? "";
  if (authorization !== "") {
    return Option.some(
      Option.getOrElse(bearerOf(authorization), () => authorization),
    );
  }
  const key = headers["x-api-key"]?.trim() ?? "";
  return key === "" ? Option.none() : Option.some(key);
};
