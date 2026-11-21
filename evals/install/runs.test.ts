import { describe, expect, it } from "@effect/vitest";
import { reportOf } from "./report.ts";
import { maskedOf, type Run } from "./runs.ts";

const run: Run = {
  id: "20261118t0652-be09",
  commit: "e62c69f",
  dirty: false,
  task: "studio-and-laptop",
  installer: "rehearsal",
  startedAt: "2026-11-18T06:52:00.000Z",
  minutes: 0.8,
  limitMinutes: 30,
  ending: "failed",
  error: "the hub did not start: give it the setup code A0EW-CBGV-VHC6",
  verdicts: [
    {
      id: "secrets",
      passed: false,
      problems: ["the setup code is in what studio printed"],
    },
  ],
  passed: false,
  transcript: [
    {
      kind: "command",
      at: "2026-11-18T06:52:01.000Z",
      actor: "owner",
      machine: "studio",
      command: "cat ~/cota-hub/secrets/clients",
      cwd: "/home/owner",
      stdin: false,
      exitCode: 0,
      stdout: "47624a00667cc3ef9c80b5aa73be13d9\n",
      stderr: "",
      seconds: 0.1,
    },
    {
      kind: "message",
      at: "2026-11-18T06:52:02.000Z",
      from: "installer",
      text: "Your setup code is A0EW-CBGV-VHC6, and your key 47624a00667cc3ef9c80b5aa73be13d9.",
    },
  ],
  spend: [
    {
      who: "installer",
      model: "claude-sonnet-5-5",
      costUsd: 1.25,
      turns: 40,
    },
  ],
  installerTranscript: [
    {
      kind: "call",
      tool: "mcp__world__run",
      input:
        '{"machine":"studio","command":"echo 47624a00667cc3ef9c80b5aa73be13d9"}',
    },
    {
      kind: "returned",
      text: "Exit status 0.\nstdout:\n47624a00667cc3ef9c80b5aa73be13d9",
      isError: false,
    },
    { kind: "text", text: "The code is A0EW-CBGV-VHC6." },
  ],
};

describe("what a run keeps of its secrets", () => {
  it("keeps every secret's name where it was, and none of its value", () => {
    const masked = maskedOf(run, [
      { name: "setup code", value: "A0EW-CBGV-VHC6" },
      {
        name: "cota-hub/secrets/clients",
        value: "47624a00667cc3ef9c80b5aa73be13d9",
      },
      { name: "an empty file", value: "" },
    ]);
    const written = JSON.stringify(masked);
    expect(written).not.toContain("A0EW-CBGV-VHC6");
    expect(written).not.toContain("47624a00667cc3ef9c80b5aa73be13d9");
    expect(masked.error).toBe(
      "the hub did not start: give it the setup code ‹setup code›",
    );
    expect(masked.transcript[1]).toMatchObject({
      text: "Your setup code is ‹setup code›, and your key ‹cota-hub/secrets/clients›.",
    });
    expect(masked.installerTranscript).toEqual([
      {
        kind: "call",
        tool: "mcp__world__run",
        input:
          '{"machine":"studio","command":"echo ‹cota-hub/secrets/clients›"}',
      },
      {
        kind: "returned",
        text: "Exit status 0.\nstdout:\n‹cota-hub/secrets/clients›",
        isError: false,
      },
      { kind: "text", text: "The code is ‹setup code›." },
    ]);
    expect({
      ...masked,
      error: run.error,
      transcript: run.transcript,
      installerTranscript: run.installerTranscript,
    }).toEqual(run);
  });
});

describe("a report's first sentence", () => {
  it("says the installer was done only when it said so", () => {
    expect(reportOf({ ...run, ending: "done", error: null })).toContain(
      "and ended saying it was done.",
    );
    const unfinished = reportOf({
      ...run,
      ending: "unfinished",
      error: "Still to do: launch a client on laptop.",
    });
    expect(unfinished).toContain(
      'and ended its turn without saying it was done: "Still to do: launch a client on laptop.".',
    );
    expect(unfinished).not.toContain("saying it was done.");
  });
});
