import type { QueryClient } from "@tanstack/react-query";
import { Effect } from "effect";
import { useApiQuery } from "./api.ts";

const meKey = ["sign-in", "me"];
const waysInKey = ["sign-in", "ways-in"];

/** Who is signed in, as `GET /api/me` answers, or null when nobody is. */
export const useMe = () =>
  useApiQuery(meKey, (client) =>
    client["sign-in"]
      .me()
      .pipe(Effect.catchTag("SignInRequired", () => Effect.succeed(null))),
  );

/** How the owner signs in here, as `GET /api/sign-in` answers: anyone may ask. */
export const useWaysIn = () =>
  useApiQuery(waysInKey, (client) => client["sign-in"].waysIn());

/** Asks the hub again how the owner signs in, as when the ways in changed since it was asked. */
export const askWaysInAgain = (queries: QueryClient) =>
  queries.invalidateQueries({ queryKey: waysInKey });

/** Reads again who is signed in, as after signing in. */
export const readMeAgain = (queries: QueryClient) =>
  queries.invalidateQueries({ queryKey: meKey });

/** Marks nobody signed in, and forgets every answer read while somebody was. */
export const signedOut = (queries: QueryClient) => {
  queries.setQueryData(meKey, null);
  queries.removeQueries({
    predicate: ({ queryKey }) =>
      queryKey.length !== meKey.length ||
      queryKey.some((part, index) => part !== meKey[index]),
  });
};
