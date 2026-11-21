import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Layer, Result, Schema } from "effect";
import * as ReadHubKeys from "#02-application/queries/read-hub-keys.query.ts";
import * as HubAddress from "#03-domain/hub-address.ts";
import * as Paths from "#03-domain/paths.ts";
import * as Cota from "#05-tests/cota.ts";
import * as InMemoryFiles from "#05-tests/fakes/in-memory-files.ts";
import * as InMemoryTitleSources from "#05-tests/fakes/in-memory-title-sources.ts";
import * as ScriptedTitleReports from "#05-tests/fakes/scripted-title-reports.ts";
import * as ReportTitles from "./report-titles.command.ts";

const variables = { HOME: "/home/me" };
const paths = Result.getOrThrow(Paths.pathsOf("linux", variables));
const configuration = {
  hub: Result.getOrThrow(HubAddress.read("http://127.0.0.1:18080", false)),
  machine: "studio",
};

/** A run: the title T3 Code shows for each of seven sessions (none, blank, or one of three), and how the hub answers each batch, in turn. */
const Run = Schema.Struct({
  titles: Schema.Array(
    Schema.Literals(["none", "  ", "Fix the relay", "Ship it", "Ship it 🚀"]),
  ).check(Schema.isMaxLength(7)),
  answers: Schema.Array(Schema.Literals([204, 204, 503, 401, "never"])),
});

describe("title reporter laws", () => {
  it.effect.prop(
    "J12: For any sequence of changes and runs whose batches are kept or fail, a session's current title is among those each run has to send until a batch holding it is answered 204, and among none after until it changes; a run sends them in batches, in order, until one is not kept.",
    { runs: Arbitrary.schema(Schema.Array(Run)) },
    ({ runs }) =>
      Effect.gen(function* () {
        const { layer: files } = InMemoryFiles.make([
          [paths.hubKeys, { kind: "directory", mode: 0o700 }],
          [
            Paths.hubKeyFile(paths, "subscription"),
            { kind: "file", text: "subscription-hub-key\n", mode: 0o600 },
          ],
        ]);
        const sources = InMemoryTitleSources.make();
        let answers: Array<ScriptedTitleReports.Answer> = [];
        const hub = ScriptedTitleReports.make(() => answers.shift() ?? 204);
        const report = yield* ReportTitles.ReportTitles.pipe(
          Effect.provide(
            ReportTitles.layerOf(3).pipe(
              Layer.provideMerge(ReadHubKeys.layer),
              Layer.provideMerge(
                Layer.mergeAll(
                  files,
                  sources.layer,
                  hub.layer,
                  Cota.environment(variables),
                ),
              ),
            ),
          ),
        );

        /** What the hub kept for each session, as the stand-in answered; the last run changes nothing, and the hub keeps all it is sent. */
        const kept = new Map<string, string>();
        let current = new Map<string, string>();
        const unchanged = { answers: [] };
        for (const run of [...runs, unchanged]) {
          if ("titles" in run) {
            current = new Map(
              run.titles.flatMap((title, index) =>
                title === "none" || title.trim() === ""
                  ? []
                  : [[`session-${index}`, title] as const],
              ),
            );
            sources.sources.t3 = run.titles.flatMap((title, index) =>
              title === "none" ? [] : [[`session-${index}`, title] as const],
            );
          }
          answers = [...run.answers];
          for (const session of [...kept.keys()]) {
            if (!current.has(session)) kept.delete(session);
          }
          const due = new Map(
            [...current].filter(
              ([session, title]) => kept.get(session) !== title,
            ),
          );
          const before = hub.sent.length;
          const { kept: count, problems } = yield* report.execute(
            paths,
            configuration,
          );
          const batches = hub.sent.slice(before);
          const sent = batches.flatMap(({ titles }) => [...titles]);
          for (const { titles, answer } of batches) {
            expect(titles.size).toBeGreaterThan(0);
            expect(titles.size).toBeLessThanOrEqual(3);
            if (answer === 204) {
              for (const [session, title] of titles) kept.set(session, title);
            }
          }
          expect(new Set(sent.map(([session]) => session)).size).toBe(
            sent.length,
          );
          for (const [session, title] of sent) {
            expect(due.get(session)).toBe(title);
          }
          expect(
            batches.slice(0, -1).every(({ answer }) => answer === 204),
          ).toBe(true);
          const stopped = batches.some(({ answer }) => answer !== 204);
          expect(problems.length > 0).toBe(stopped);
          if (!stopped) expect(new Map(sent)).toEqual(due);
          expect(count).toBe(
            batches
              .filter(({ answer }) => answer === 204)
              .reduce((sum, { titles }) => sum + titles.size, 0),
          );
        }
      }),
    { arbitrary: { runs: 300 } },
  );
});
