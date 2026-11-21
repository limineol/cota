import { useMutation } from "@tanstack/react-query";
import { use } from "react";
import { ApiCaller, type Client, useApiQuery } from "#shared/api.ts";

const readSchema = (client: Client) => client.sql.schema();

/** The request log's tables and their columns, as the SQL user sees them. */
export const useSchema = () => useApiQuery(["sql", "schema"], readSchema);

export type SchemaAnswer = NonNullable<ReturnType<typeof useSchema>["data"]>;
export type SchemaTable = SchemaAnswer["tables"][number];

interface Asked {
  readonly sql: string;
  readonly signal: AbortSignal;
}

/** A run of one statement, abandoned when its signal is. */
export const useRun = () => {
  const caller = use(ApiCaller);
  return useMutation({
    mutationFn: ({ sql, signal }: Asked) =>
      caller((client) => client.sql.sql({ payload: { sql } }), signal),
  });
};

export type RunAnswer = NonNullable<ReturnType<typeof useRun>["data"]>;
