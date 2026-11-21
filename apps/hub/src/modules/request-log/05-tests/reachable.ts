import { server } from "./scratch.ts";

/**
 * Fails the request log's tests at once, saying why, when their ClickHouse cannot
 * be reached: they never skip.
 */
export default async function reachable(): Promise<void> {
  const answer = await fetch(`${server.url}/?query=SELECT%201`, {
    headers: {
      authorization: `Basic ${btoa(`${server.user}:${server.password}`)}`,
    },
  }).then(
    (response) => (response.ok ? "" : `it answered ${response.status}`),
    (error: unknown) => String(error),
  );
  if (answer === "") return;
  throw new Error(
    `The request log's tests need ClickHouse at ${server.url}, and ${answer}. Start it with \`docker compose -f compose.dev.yaml up -d --wait\`, or name another with COTA_TEST_CLICKHOUSE_URL, COTA_TEST_CLICKHOUSE_USER and COTA_TEST_CLICKHOUSE_PASSWORD.`,
  );
}
