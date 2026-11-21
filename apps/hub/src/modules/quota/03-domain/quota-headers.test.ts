import { describe, expect, it } from "@effect/vitest";
import { DateTime, Duration, Option } from "effect";
import * as QuotaHeaders from "./quota-headers.ts";

const startedAt = DateTime.makeUnsafe("2026-11-12T09:15:00.000Z");
const resetAt = (iso: string) =>
  String(DateTime.toEpochMillis(DateTime.makeUnsafe(iso)) / 1000);

const answer = (
  headers: Record<string, string>,
  at = startedAt,
): QuotaHeaders.Answer => ({ startedAt: at, headers });

/** Each name asked, answered by the one answer given. */
const observed = (
  protocol: Parameters<typeof QuotaHeaders.namesOf>[0],
  given: QuotaHeaders.Answer,
) =>
  QuotaHeaders.observe(
    protocol,
    new Map(
      QuotaHeaders.namesOf(protocol)
        .filter((name) => Object.hasOwn(given.headers, name))
        .map((name) => [name, given]),
    ),
  );

const plain = ({ windows, plan }: ReturnType<typeof observed>) => ({
  windows: windows.map((window) => ({
    lengthMs: Duration.toMillis(window.length),
    used: window.used,
    span:
      window.span === undefined
        ? null
        : [
            DateTime.formatIso(window.span.start),
            DateTime.formatIso(window.span.reset),
          ],
    observedAt: DateTime.formatIso(window.observedAt),
  })),
  plan: Option.getOrNull(plan),
});

describe("the windows of quota headers", () => {
  it("asks Anthropic's answers for both utilizations, Codex's for both used percentages and the plan, and OpenAI Chat's for nothing", () => {
    expect([
      QuotaHeaders.namesOf("anthropic-messages"),
      QuotaHeaders.namesOf("chatgpt-codex"),
      QuotaHeaders.namesOf("openai-chat"),
    ]).toEqual([
      [
        "anthropic-ratelimit-unified-5h-utilization",
        "anthropic-ratelimit-unified-7d-utilization",
      ],
      [
        "x-codex-primary-used-percent",
        "x-codex-secondary-used-percent",
        "x-codex-plan-type",
      ],
      [],
    ]);
  });

  it("reads an Anthropic answer as recorded, with the 7-day window only, its fraction as a percentage", () => {
    expect(
      plain(
        observed(
          "anthropic-messages",
          answer({
            "anthropic-ratelimit-unified-7d-utilization": "0.57",
            "anthropic-ratelimit-unified-7d-reset": resetAt(
              "2026-11-17T00:00:00Z",
            ),
            "anthropic-ratelimit-unified-7d-status": "allowed",
            "anthropic-ratelimit-unified-reset": resetAt(
              "2026-11-17T00:00:00Z",
            ),
            "anthropic-ratelimit-unified-representative-claim": "seven_day",
          }),
        ),
      ),
    ).toEqual({
      windows: [
        {
          lengthMs: 7 * 24 * 3_600_000,
          used: 57,
          span: ["2026-11-10T00:00:00.000Z", "2026-11-17T00:00:00.000Z"],
          observedAt: "2026-11-12T09:15:00.000Z",
        },
      ],
      plan: null,
    });
  });

  it("reads both of Anthropic's windows when both are sent, each from the answer that holds its utilization", () => {
    const later = DateTime.makeUnsafe("2026-11-12T09:20:00.000Z");
    expect(
      plain(
        QuotaHeaders.observe(
          "anthropic-messages",
          new Map([
            [
              "anthropic-ratelimit-unified-5h-utilization",
              answer(
                {
                  "anthropic-ratelimit-unified-5h-utilization": "0.86",
                  "anthropic-ratelimit-unified-5h-reset": resetAt(
                    "2026-11-12T11:00:00Z",
                  ),
                },
                later,
              ),
            ],
            [
              "anthropic-ratelimit-unified-7d-utilization",
              answer({
                "anthropic-ratelimit-unified-7d-utilization": "0.41",
                "anthropic-ratelimit-unified-7d-reset": resetAt(
                  "2026-11-17T00:00:00Z",
                ),
                "anthropic-ratelimit-unified-5h-reset": resetAt(
                  "2026-11-12T12:00:00Z",
                ),
              }),
            ],
          ]),
        ),
      ),
    ).toEqual({
      windows: [
        {
          lengthMs: 5 * 3_600_000,
          used: 86,
          span: ["2026-11-12T06:00:00.000Z", "2026-11-12T11:00:00.000Z"],
          observedAt: "2026-11-12T09:20:00.000Z",
        },
        {
          lengthMs: 7 * 24 * 3_600_000,
          used: 41,
          span: ["2026-11-10T00:00:00.000Z", "2026-11-17T00:00:00.000Z"],
          observedAt: "2026-11-12T09:15:00.000Z",
        },
      ],
      plan: null,
    });
  });

  it("reads a Codex answer as measured: a weekly primary window, no secondary window where its minutes are 0, and the plan", () => {
    expect(
      plain(
        observed(
          "chatgpt-codex",
          answer({
            "x-codex-primary-used-percent": "12",
            "x-codex-primary-window-minutes": "10080",
            "x-codex-primary-reset-at": resetAt("2026-11-17T00:00:00Z"),
            "x-codex-primary-reset-after-seconds": "398700",
            "x-codex-secondary-used-percent": "0",
            "x-codex-secondary-window-minutes": "0",
            "x-codex-secondary-reset-at": "",
            "x-codex-secondary-reset-after-seconds": "0",
            "x-codex-active-limit": "premium",
            "x-codex-plan-type": "pro",
          }),
        ),
      ),
    ).toEqual({
      windows: [
        {
          lengthMs: 7 * 24 * 3_600_000,
          used: 12,
          span: ["2026-11-10T00:00:00.000Z", "2026-11-17T00:00:00.000Z"],
          observedAt: "2026-11-12T09:15:00.000Z",
        },
      ],
      plan: "Pro 20x",
    });
  });

  it("trims a value, clamps a percentage to 0 to 100, gives no span for a reset that is empty or not above 0, and takes minutes in whole milliseconds", () => {
    expect(
      plain(
        observed(
          "chatgpt-codex",
          answer({
            "x-codex-primary-used-percent": " 250 ",
            "x-codex-primary-window-minutes": " 300 ",
            "x-codex-primary-reset-at": "0",
            "x-codex-secondary-used-percent": "-3",
            "x-codex-secondary-window-minutes": "0.00001",
            "x-codex-secondary-reset-at": "",
          }),
        ),
      ).windows,
    ).toEqual([
      {
        lengthMs: 5 * 3_600_000,
        used: 100,
        span: null,
        observedAt: "2026-11-12T09:15:00.000Z",
      },
    ]);
  });

  it("takes a value that is not a decimal number as no value: no window without a percentage or a length, and no span without a reset", () => {
    expect(
      [
        { used: "1e3", minutes: "300", reset: "1794477600" },
        { used: "41", minutes: "abc", reset: "1794477600" },
        { used: "41", minutes: "-60", reset: "1794477600" },
        { used: "", minutes: "300", reset: "1794477600" },
        { used: "41", minutes: "300", reset: "0x10" },
      ].map(
        ({ used, minutes, reset }) =>
          plain(
            observed(
              "chatgpt-codex",
              answer({
                "x-codex-primary-used-percent": used,
                "x-codex-primary-window-minutes": minutes,
                "x-codex-primary-reset-at": reset,
              }),
            ),
          ).windows.map(({ span }) => span)[0],
      ),
    ).toEqual([undefined, undefined, undefined, undefined, null]);
  });

  it("names ChatGPT's plans as its reader does, and gives none for an empty one", () => {
    expect(
      [
        "pro",
        "prolite",
        "pro_lite",
        "free_workspace",
        "plus",
        " team ",
        "",
      ].map(
        (planType) =>
          plain(
            observed(
              "chatgpt-codex",
              answer({ "x-codex-plan-type": planType }),
            ),
          ).plan,
      ),
    ).toEqual([
      "Pro 20x",
      "Pro 5x",
      "Pro 5x",
      "Free Workspace",
      "Plus",
      "Team",
      null,
    ]);
  });
});
