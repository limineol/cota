import type { QueryClient } from "@tanstack/react-query";
import { Clock, DateTime, Effect } from "effect";
import { type Client, useApiQuery } from "#shared/api.ts";
import { useLogBegins } from "#shared/log-begins.ts";
import { startOf } from "#shared/range.ts";

const listPools = (client: Client) => client.pools.list();

/** The pools of the configuration, with their quota logins, their hues and their marks. */
export const usePools = () => useApiQuery(["settings", "pools"], listPools);

export type Pool = NonNullable<
  ReturnType<typeof usePools>["data"]
>["pools"][number];

/** Reads every screen's pools again, as after a quota login is forgotten. */
export const readPoolsAgain = (queries: QueryClient) =>
  queries.invalidateQueries({
    predicate: ({ queryKey }) => queryKey[1] === "pools",
  });

/**
 * Every id the request log has for each kind, over all time, most requests
 * first; null while the log is empty.
 */
export const useSeen = () => {
  const log = useLogBegins(true);
  const start = startOf("all", log.data);
  const facets = useApiQuery(
    ["settings", "facets", start?.key ?? null],
    start === null
      ? null
      : (client) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            return yield* client.traffic.facets({
              query: {
                from: DateTime.makeUnsafe(start.at(now)),
                to: DateTime.makeUnsafe(now),
              },
            });
          }),
  );
  if (log.isError)
    return {
      state: "failed",
      error: log.error,
      retry: () => log.refetch(),
    } as const;
  if (log.data === undefined) return { state: "loading" } as const;
  if (log.data === null) return { state: "read", facets: null } as const;
  if (facets.isError)
    return {
      state: "failed",
      error: facets.error,
      retry: () => facets.refetch(),
    } as const;
  if (facets.data === undefined) return { state: "loading" } as const;
  return { state: "read", facets: facets.data } as const;
};

const listSignIns = (client: Client) => client["sign-in"].signIns();

const signInsKey = ["settings", "sign-ins"];

/** The owner's sign-ins, or nothing while the caller is not the owner, who alone may list them. */
export const useSignIns = (owner: boolean) =>
  useApiQuery(signInsKey, owner ? listSignIns : null);

export type SignIn = NonNullable<
  ReturnType<typeof useSignIns>["data"]
>["signIns"][number];

export const readSignInsAgain = (queries: QueryClient) =>
  queries.invalidateQueries({ queryKey: signInsKey });

const ownerPasswordKey = ["settings", "owner-password"];

/** Where the owner password is kept, or nothing while the caller is not the owner. */
export const useOwnerPassword = (owner: boolean) =>
  useApiQuery(
    ownerPasswordKey,
    owner ? (client: Client) => client["sign-in"].ownerPassword() : null,
  );

const passkeysKey = ["settings", "passkeys"];

/** The owner's passkeys, newest first, or nothing while the caller is not the owner. */
export const useKeptPasskeys = (owner: boolean) =>
  useApiQuery(
    passkeysKey,
    owner ? (client: Client) => client["sign-in"].passkeys() : null,
  );

export type Passkey = NonNullable<
  ReturnType<typeof useKeptPasskeys>["data"]
>["passkeys"][number];

/** Reads the ways in again, the password's place and the passkeys, as after one changed. */
export const readWaysInAgain = (queries: QueryClient) =>
  Promise.all([
    queries.invalidateQueries({ queryKey: ownerPasswordKey }),
    queries.invalidateQueries({ queryKey: passkeysKey }),
  ]);

const routesKey = ["settings", "routes"];

/** Each routed client's routes and default pool, as the hub keeps them. */
export const useRoutes = () =>
  useApiQuery(routesKey, (client: Client) => client.routes.list());

export type RouteList = NonNullable<
  ReturnType<typeof useRoutes>["data"]
>["clients"][number];

/** Reads the routes again, and every answer of which pool a project bills, as after the routes changed. */
export const readRoutesAgain = (queries: QueryClient) =>
  Promise.all([
    queries.invalidateQueries({ queryKey: routesKey }),
    queries.invalidateQueries({ queryKey: ["settings", "route"] }),
  ]);
