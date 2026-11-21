import { Option } from "effect";

/** Gives the token of an `authorization` header that is `Bearer <token>`. */
export const bearerOf = (
  authorization: string | undefined,
): Option.Option<string> =>
  Option.fromUndefinedOr(/^bearer\s+(\S+)\s*$/i.exec(authorization ?? "")?.[1]);
