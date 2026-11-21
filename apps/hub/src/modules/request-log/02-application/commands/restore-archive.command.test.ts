import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option } from "effect";
import { TestClock } from "effect/testing";
import * as Archive from "#modules/request-log/03-domain/archive.ts";
import * as InMemoryArchiveDirectory from "#modules/request-log/05-tests/fakes/in-memory-archive-directory.ts";
import * as Scripted from "#modules/request-log/05-tests/fakes/scripted-request-log-archive.ts";
import * as ArchiveDaysCommand from "./archive-days.command.ts";
import * as RestoreArchiveCommand from "./restore-archive.command.ts";

const noon = Date.UTC(2026, 10, 9, 12);

describe("RestoreArchive", () => {
  it.effect(
    "reports a day failed, not added, when the log still lacks some of its rows after they were added",
    () => {
      const log = Scripted.emptyLog();
      log.requests.push(
        { id: "first", at: noon, text: "a" },
        { id: "second", at: noon + 1, text: "b" },
      );
      return Effect.gen(function* () {
        yield* TestClock.setTime(Date.UTC(2026, 10, 11));
        yield* (yield* ArchiveDaysCommand.ArchiveDays).execute;
        const script = yield* Scripted.ScriptedRequestLogArchive;
        for (const table of Archive.tables) script.log[table] = [];
        script.faults = [
          { op: "lacking", at: script.calls.lacking, how: "leaves out" },
        ];

        const restored =
          yield* (yield* RestoreArchiveCommand.RestoreArchive).execute({
            from: Option.none(),
            to: Option.none(),
          });

        expect(restored).toEqual([
          [
            Scripted.dayOf(noon),
            {
              _tag: "Failed",
              detail: expect.stringContaining("1 rows of requests"),
            },
          ],
        ]);
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            ArchiveDaysCommand.layer,
            RestoreArchiveCommand.layer,
          ).pipe(
            Layer.provideMerge(
              Layer.mergeAll(
                InMemoryArchiveDirectory.layer,
                Scripted.layer(log),
              ),
            ),
          ),
        ),
      );
    },
  );
});
