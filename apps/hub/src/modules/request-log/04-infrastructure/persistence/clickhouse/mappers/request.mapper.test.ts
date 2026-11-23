import { describe, expect, it } from "@effect/vitest";
import { DateTime, Option } from "effect";
import * as StoredItems from "#modules/request-log/03-domain/stored-items.ts";
import { LoginFingerprint, PoolId } from "#shared/03-domain/ids.ts";
import * as Request from "#shared/03-domain/request.entity.ts";
import * as Harness from "#shared/05-tests/harness.ts";
import * as RequestMapper from "./request.mapper.ts";

const id = Request.RequestId.make("01a1cf3f-cb03-7002-bfce-12cb5c6fcfa9");
const follows = Request.RequestId.make("01a1cf3f-0000-7000-8000-000000000001");

describe("the requests row", () => {
  it("puts every field of a request in its column of requests", () => {
    const request = Harness.requestOf({
      id,
      startedAt: DateTime.makeUnsafe("2026-11-12T08:30:00.250Z"),
      firstByteMs: Option.some(12),
      durationMs: 3456,
      session: "s-1",
      sessionSource: "x-claude-code-session-id",
      machine: "workstation",
      project: "cota",
      client: "claude-code",
      clientVersion: "2.3.1",
      userAgent: "claude-cli/2.3.1 (external, cli)",
      divertedFrom: Option.some(PoolId.make("claude")),
      follows: Option.some(follows),
      loginFingerprint: Option.some(LoginFingerprint.make("fp_5e2a")),
      refusalReset: Option.some(DateTime.makeUnsafe("2026-11-12T13:00:00Z")),
      provider: "anthropic",
      protocol: "anthropic-messages",
      operation: "messages",
      purpose: "title",
      model: "claude-opus-5-5",
      servedModel: "claude-opus-5-5-20261001",
      stream: true,
      outcome: "refused",
      upstreamStatus: 429,
      errorType: "rate_limit_error",
      errorMessage: "This request would exceed your rate limit.",
      stopReason: "end_turn",
      usage: Option.some({
        tokens: {
          input: 10,
          cacheRead: 20,
          cacheWriteShort: 30,
          cacheWriteLong: 40,
          output: 50,
        },
        reasoning: 5,
        reported: '{"input_tokens":10}',
      }),
      serviceTier: "fast",
      providerRequestId: "req_011",
      rateLimits: { "anthropic-ratelimit-unified-reset": "1794459600" },
      clientHeaders: { "anthropic-beta": "fast-mode-2026-02-01" },
      errorBody: '{"type":"error"}',
      requestBytes: 1234,
      responseBytes: 567,
      readingComplete: false,
    });

    expect(
      RequestMapper.requestRowOf({
        request: StoredItems.storedOf(request),
        cost: Option.some(1_500_000_000_001n),
      }),
    ).toEqual({
      id,
      started_at: "2026-11-12T08:30:00.250Z",
      first_byte_ms: 12,
      duration_ms: 3456,
      session: "s-1",
      session_source: "x-claude-code-session-id",
      machine: "workstation",
      project: "cota",
      client: "claude-code",
      client_version: "2.3.1",
      user_agent: "claude-cli/2.3.1 (external, cli)",
      hub_key: "clients",
      pool: "solo",
      diverted_from: "claude",
      follows,
      login_fingerprint: "fp_5e2a",
      refusal_reset: "2026-11-12T13:00:00.000Z",
      provider: "anthropic",
      protocol: "anthropic-messages",
      operation: "messages",
      purpose: "title",
      model: "claude-opus-5-5",
      served_model: "claude-opus-5-5-20261001",
      stream: true,
      outcome: "refused",
      upstream_status: 429,
      error_type: "rate_limit_error",
      error_message: "This request would exceed your rate limit.",
      stop_reason: "end_turn",
      usage_reported: true,
      input_tokens: 10,
      cache_read_tokens: 20,
      cache_write_short_tokens: 30,
      cache_write_long_tokens: 40,
      output_tokens: 50,
      reasoning_tokens: 5,
      service_tier: "fast",
      cost_usd: "1.500000000001",
      provider_request_id: "req_011",
      rate_limits: { "anthropic-ratelimit-unified-reset": "1794459600" },
      client_headers: { "anthropic-beta": "fast-mode-2026-02-01" },
      usage: '{"input_tokens":10}',
      error_body: '{"type":"error"}',
      request_bytes: 1234,
      response_bytes: 567,
      reading_complete: false,
    });
  });

  it("writes a request without usage with zero tokens, no usage and no cost, and what it lacks as empty or null", () => {
    const row = RequestMapper.requestRowOf({
      request: StoredItems.storedOf(Harness.requestOf({ id })),
      cost: Option.none(),
    });
    expect([
      row.usage_reported,
      row.input_tokens,
      row.reasoning_tokens,
      row.usage,
      row.cost_usd,
      row.first_byte_ms,
      row.follows,
      row.refusal_reset,
      row.diverted_from,
      row.login_fingerprint,
    ]).toEqual([false, 0, 0, "", null, null, null, null, "", ""]);
  });

  it("writes a cost in picodollars as exact dollars with twelve decimals, and none from a million dollars on", () => {
    expect(
      [0n, 1n, 1_500_000_000_001n, 999_999_999_999_999_999n, 10n ** 18n].map(
        RequestMapper.dollarsOf,
      ),
    ).toEqual([
      Option.some("0.000000000000"),
      Option.some("0.000000000001"),
      Option.some("1.500000000001"),
      Option.some("999999.999999999999"),
      Option.none(),
    ]);
  });
});
