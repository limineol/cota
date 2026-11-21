import { type Client, useApiQuery } from "#shared/api.ts";

const listPools = (client: Client) => client.pools.list();

/** The pools of the configuration, for their hues and marks. */
export const usePoolList = () =>
  useApiQuery(["request", "pools"], listPools, {
    refetchInterval: 5 * 60_000,
  });

/** One request as the inspector reads it: its record, its place in its session, and its conversation's parts. */
export const useInspected = (id: string) =>
  useApiQuery(["request", "inspect", id], (client) =>
    client.requests.request({ params: { id } }),
  );

export type Inspected = NonNullable<ReturnType<typeof useInspected>["data"]>;
export type RequestRecord = Inspected["request"];
