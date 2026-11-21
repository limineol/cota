/** Queries to start from, over the request log's tables (`docs/specs/request-log/spec.md`). */
export const examples: ReadonlyArray<{
  readonly title: string;
  readonly detail: string;
  readonly sql: string;
}> = [
  {
    title: "Requests in the last day",
    detail: "The latest 100, newest first",
    sql: `SELECT started_at, pool, model, outcome, duration_ms, cost_usd
FROM requests
WHERE started_at > now() - INTERVAL 1 DAY
ORDER BY started_at DESC
LIMIT 100`,
  },
  {
    title: "Usage by pool and day",
    detail: "Requests, tokens and cost over 30 days",
    sql: `SELECT
  toDate(started_at) AS day,
  pool,
  count() AS requests,
  sum(prompt_tokens) AS prompt_tokens,
  sum(output_tokens) AS output_tokens,
  sum(cost_usd) AS cost_usd
FROM requests
WHERE started_at > now() - INTERVAL 30 DAY
GROUP BY day, pool
ORDER BY day DESC, requests DESC`,
  },
  {
    title: "Sessions by cost",
    detail: "The 50 dearest sessions of the week",
    sql: `SELECT
  session,
  any(project) AS project,
  count() AS requests,
  min(started_at) AS began,
  sum(cost_usd) AS cost_usd
FROM requests
WHERE session != '' AND started_at > now() - INTERVAL 7 DAY
GROUP BY session
ORDER BY cost_usd DESC
LIMIT 50`,
  },
  {
    title: "Errors by provider",
    detail: "Failures of the week by status and type",
    sql: `SELECT
  provider,
  upstream_status,
  error_type,
  count() AS requests,
  max(started_at) AS latest
FROM requests
WHERE outcome = 'error' AND started_at > now() - INTERVAL 7 DAY
GROUP BY provider, upstream_status, error_type
ORDER BY requests DESC`,
  },
  {
    title: "Cache reads by model",
    detail: "How much of each model's prompts came from its cache",
    sql: `SELECT
  model,
  sum(prompt_tokens) AS prompt_tokens,
  sum(cache_read_tokens) AS cache_read_tokens,
  round(100 * sum(cache_read_tokens) / nullIf(sum(prompt_tokens), 0), 1) AS cached_percent
FROM requests
WHERE usage_reported AND started_at > now() - INTERVAL 7 DAY
GROUP BY model
ORDER BY prompt_tokens DESC`,
  },
  {
    title: "Slowest first bytes",
    detail: "The 50 longest waits for an answer today",
    sql: `SELECT started_at, pool, model, first_byte_ms, duration_ms, id
FROM requests
WHERE first_byte_ms IS NOT NULL AND started_at > now() - INTERVAL 1 DAY
ORDER BY first_byte_ms DESC
LIMIT 50`,
  },
  {
    title: "Search the conversations",
    detail: "Items whose text has every word, by the text index",
    sql: `SELECT session, first_seen, role, substring(text, 1, 200) AS text
FROM items FINAL
WHERE hasAllTokens(text, 'deploy failed')
ORDER BY first_seen DESC
LIMIT 50`,
  },
  {
    title: "Titles of recent sessions",
    detail: "The latest title each session reported",
    sql: `SELECT
  session,
  argMax(title, reported_at) AS title,
  max(reported_at) AS reported_at
FROM session_titles
GROUP BY session
ORDER BY reported_at DESC
LIMIT 50`,
  },
];
