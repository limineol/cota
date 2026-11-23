import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Schema } from "effect";
import { fromStart, readingOf } from "#03-domain/antigravity-record.ts";
import { conversationOf, Plan, plan } from "#05-tests/antigravity-records.ts";
import * as Cota from "#05-tests/cota.ts";
import * as InMemoryClientRecords from "#05-tests/fakes/in-memory-client-records.ts";
import * as InMemoryFiles from "#05-tests/fakes/in-memory-files.ts";
import * as ScriptedHub from "#05-tests/fakes/scripted-hub.ts";
import * as ScriptedRequestReports from "#05-tests/fakes/scripted-request-reports.ts";
import * as ScriptedTerminal from "#05-tests/fakes/scripted-terminal.ts";

const folder = "/home/me/agy";
const key = "subscription-hub-key-0001";
const good = "c0ffee00-0000-4000-8000-00000000000a";
const bad = "c0ffee00-0000-4000-8000-00000000000b";

const opening: ReadonlyArray<Plan> = [
  plan("user"),
  plan("model"),
  plan("tool"),
  plan("model"),
];

const Defect = Schema.Literals([
  "sub-agent",
  "schema",
  "subtrajectory",
  "unreadable-step",
  "rewritten",
]);

describe("request reporter laws through cota", () => {
  it.effect.prop(
    "J24: For any record with a table or column missing, a sub-agent, a step that is not a protocol buffer or a record rewritten, the calls reported are those before it, and `cota requests show` and doctor name the conversation and the reason.",
    {
      defect: Arbitrary.schema(Defect),
      tail: Arbitrary.schema(Schema.Array(Plan).check(Schema.isMaxLength(6))),
    },
    ({ defect, tail }) =>
      Effect.gen(function* () {
        const plans = [...opening, ...tail];
        const valid = conversationOf(bad, plans);
        const records = InMemoryClientRecords.make();
        const conversations = new Map([
          [good, conversationOf(good, plans)],
          [
            bad,
            defect === "sub-agent"
              ? { ...valid, subAgent: true }
              : defect === "schema"
                ? { ...valid, schema: "other" as const }
                : defect === "subtrajectory"
                  ? {
                      ...valid,
                      steps: valid.steps.map((step) =>
                        step.idx === 2
                          ? { ...step, hasSubtrajectory: true }
                          : step,
                      ),
                    }
                  : defect === "unreadable-step"
                    ? {
                        ...valid,
                        steps: valid.steps.map((step) =>
                          step.idx === 2 ? { ...step, payload: null } : step,
                        ),
                      }
                    : valid,
          ],
        ]);
        records.folders.set(folder, conversations);
        const terminal = ScriptedTerminal.make({ typed: [key] });
        const reports = ScriptedRequestReports.make();
        const ports = {
          files: InMemoryFiles.make().layer,
          environment: Cota.environment({ HOME: "/home/me" }),
          terminal: terminal.layer,
          hub: ScriptedHub.make({
            keys: new Map([[key, "subscription"]]),
            observedPools: ["gemini"],
          }).layer,
          clientRecords: records.layer,
          requestReports: reports.layer,
        };
        yield* Cota.run(
          ["join", "http://127.0.0.1:18080", "--machine", "studio"],
          ports,
        );
        yield* Cota.run(
          ["requests", "add", "antigravity", folder, "gemini"],
          ports,
        );
        if (defect === "rewritten") {
          conversations.set(bad, conversationOf(bad, plans.slice(0, 2)));
          yield* Cota.run(["requests", "report"], ports);
        }
        const whole = readingOf(
          InMemoryClientRecords.recordOf(bad, valid, -1),
          fromStart,
          true,
        ).calls;
        expect(
          reports.sent
            .flatMap(({ report }) => report.calls)
            .filter(({ session }) => session === bad)
            .map(({ call }) => call),
        ).toEqual(
          (defect === "sub-agent" || defect === "schema"
            ? []
            : defect === "rewritten"
              ? whole
              : whole.filter(({ step }) => step < 2)
          ).map(({ call }) => call),
        );
        const before = terminal.printed.out.length;
        yield* Cota.run(["requests", "show", "--json"], ports);
        const shown = JSON.parse(terminal.printed.out.slice(before).join(""));
        expect(shown.folders[0].notReported).toEqual([
          {
            conversation: bad,
            reason: defect,
            step:
              defect === "subtrajectory" || defect === "unreadable-step"
                ? 2
                : null,
          },
        ]);
        const doctored = terminal.printed.out.length;
        yield* Cota.run(["doctor", "--json"], ports);
        const check = JSON.parse(
          terminal.printed.out.slice(doctored).join(""),
        ).checks.find(({ id }: { readonly id: string }) => id === "requests");
        expect(check.outcome).not.toBe("passed");
        expect(check.problem).toContain(`${bad} is not reported (${defect})`);
        expect(check.problem).not.toContain(good);
      }),
    { arbitrary: { runs: 50 } },
  );
});
