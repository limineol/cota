/**
 * Writes a constructed request log into a database of `compose.dev.yaml`'s
 * ClickHouse (or the one `COTA_TEST_CLICKHOUSE_URL`, `_USER` and `_PASSWORD`
 * name), through `RecordRequest` over the ClickHouse repository, as the hub
 * writes one: `bun write-request-log.ts <database> < log.json`. The log is a
 * JSON array of `Logged` requests; the database's tables are made first. Only
 * the memory evals run it (`docs/specs/memory-evals/spec.md`).
 */
import { BunHttpClient, BunRuntime } from "@effect/platform-bun";
import { Console, DateTime, Effect, Layer, Option, Schema } from "effect";
import * as ClickHouse from "#modules/request-log/04-infrastructure/persistence/clickhouse/client.ts";
import * as Tables from "#modules/request-log/04-infrastructure/persistence/clickhouse/schema.ts";
import * as Conversation from "#shared/03-domain/conversation.ts";
import { HubKeyName, PoolId } from "#shared/03-domain/ids.ts";
import * as Request from "#shared/03-domain/request.entity.ts";
import * as Scratch from "./scratch.ts";
import { rulesOf } from "./sessions.ts";

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** One request of a constructed log, as the memory evals write it. */
export const Logged = Schema.Struct({
  startedAt: Schema.DateTimeUtcFromString,
  durationMs: Count,
  session: Schema.String,
  machine: Schema.String,
  project: Schema.String,
  client: Schema.Literals(["claude-code", "codex"]),
  clientVersion: Schema.String,
  hubKey: Schema.NonEmptyString,
  pool: Schema.NonEmptyString,
  provider: Schema.NonEmptyString,
  protocol: Schema.Literals(["anthropic-messages", "chatgpt-codex"]),
  model: Schema.NonEmptyString,
  purpose: Schema.String,
  outcome: Request.Outcome,
  upstreamStatus: Count,
  errorType: Schema.String,
  errorMessage: Schema.String,
  body: Schema.JsonObject,
  output: Schema.Array(Schema.Json),
  usage: Schema.Struct({ input: Count, cacheRead: Count, output: Count }),
});
export type Logged = typeof Logged.Type;

const userAgentOf = (logged: Logged) =>
  logged.client === "claude-code"
    ? `claude-cli/${logged.clientVersion} (external, cli)`
    : `codex_cli_rs/${logged.clientVersion}`;

const requestOf = (logged: Logged): Request.ForwardedRequest => ({
  id: Request.RequestId.make(
    Bun.randomUUIDv7("hex", DateTime.toEpochMillis(logged.startedAt)),
  ),
  startedAt: logged.startedAt,
  durationMs: logged.durationMs,
  session: logged.session,
  machine: logged.machine,
  project: logged.project,
  client: logged.client,
  clientVersion: logged.clientVersion,
  pool: PoolId.make(logged.pool),
  provider: logged.provider,
  operation:
    logged.protocol === "anthropic-messages" ? "messages" : "responses",
  model: logged.model,
  outcome: logged.outcome,
  errorType: logged.errorType,
  errorMessage: logged.errorMessage,
  stopReason: logged.outcome === "ok" ? "end_turn" : "",
  usage: Option.some({
    tokens: {
      input: logged.usage.input,
      cacheRead: logged.usage.cacheRead,
      cacheWriteShort: 0,
      cacheWriteLong: 0,
      output: logged.usage.output,
    },
    reasoning: 0,
    reported: "{}",
  }),
  providerRequestId: "",
  conversation: Conversation.read(
    rulesOf(logged.protocol),
    logged.body,
    logged.output,
  ),
  origin: {
    _tag: "forwarded",
    protocol: logged.protocol,
    hubKey: HubKeyName.make(logged.hubKey),
    firstByteMs: Option.some(Math.min(logged.durationMs, 900)),
    sessionSource: "header",
    userAgent: userAgentOf(logged),
    divertedFrom: Option.none(),
    follows: Option.none(),
    loginFingerprint: Option.none(),
    refusalReset: Option.none(),
    purpose: logged.purpose,
    servedModel: logged.model,
    stream: true,
    upstreamStatus: logged.upstreamStatus,
    serviceTier: "",
    rateLimits: {},
    clientHeaders: {},
    errorBody: "",
    requestBytes: JSON.stringify(logged.body).length,
    responseBytes: JSON.stringify(logged.output).length,
    readingComplete: true,
  },
});

const main = Effect.gen(function* () {
  const database = process.argv[2];
  if (database === undefined || !/^cota_memory_[a-z0-9_]+$/.test(database)) {
    return yield* Effect.die(
      "write-request-log.ts writes only a database named cota_memory_<run>",
    );
  }
  const log = yield* Effect.promise(() => Bun.stdin.json()).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Logged))),
  );
  const requests = log.map((logged) => ({
    request: requestOf(logged),
    cost: Option.none(),
  }));
  yield* Effect.gen(function* () {
    yield* Tables.prepare();
    const stored = yield* Scratch.written(
      requests,
      Scratch.pricedBy(({ protocol }) =>
        protocol === "chatgpt-codex" ? "openai" : "anthropic",
      ),
    );
    yield* Console.log(
      `wrote ${stored.requests.length} requests and ${stored.items.length} items into ${database}`,
    );
  }).pipe(
    Effect.provide(
      ClickHouse.layer(Scratch.connectionTo(database)).pipe(
        Layer.provide(BunHttpClient.layer),
      ),
    ),
  );
});

BunRuntime.runMain(main);
