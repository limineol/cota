import { type Client, useApiQuery } from "#shared/api.ts";

const listPools = (client: Client) => client.pools.list();

/** The pools of the configuration, for their hues and marks. */
export const usePoolList = () =>
  useApiQuery(["session", "pools"], listPools, {
    refetchInterval: 5 * 60_000,
  });

/** A session: its row, its requests, its segments and its last segment's transcript. */
export const useSession = (session: string) =>
  useApiQuery(["session", "detail", session], (client) =>
    client.sessions.session({ params: { session } }),
  );

export type SessionAnswer = NonNullable<ReturnType<typeof useSession>["data"]>;
export type RequestSummary = SessionAnswer["requests"][number];
export type Segment = SessionAnswer["segments"][number];

/** A request as the inspector reads it, for an earlier segment's tip; read only once asked for. */
export const useRequest = (id: string, enabled: boolean) =>
  useApiQuery(
    ["session", "request", id],
    (client) => client.requests.request({ params: { id } }),
    { enabled },
  );
