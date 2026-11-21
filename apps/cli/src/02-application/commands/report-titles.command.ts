import { Context, DateTime, Effect, Layer, Option, Result } from "effect";
import { Environment } from "#02-application/interfaces/environment.ts";
import { Files } from "#02-application/interfaces/files.ts";
import { TitleReports } from "#02-application/interfaces/title-reports.ts";
import { TitleSources } from "#02-application/interfaces/title-sources.ts";
import { ReadHubKeys } from "#02-application/queries/read-hub-keys.query.ts";
import type { Configuration } from "#03-domain/configuration.ts";
import {
  type HubFailed,
  type HubKeyUnknown,
  HubUnreachable,
} from "#03-domain/machine.ts";
import { type Paths, titlesErrorFile, titlesFile } from "#03-domain/paths.ts";
import * as Titles from "#03-domain/titles.ts";

/** What a run did: how many titles the hub kept, and each problem it had, one sentence each. */
export interface Reported {
  readonly kept: number;
  readonly problems: ReadonlyArray<string>;
}

export class ReportTitles extends Context.Service<
  ReportTitles,
  {
    /**
     * One run of the title reporter (`docs/specs/title-reporter/spec.md`):
     * reads each source on from where the last run stopped, sends the hub the
     * titles that changed, in batches, recording each batch it keeps, and
     * writes `titles.error` when it had a problem, or removes it.
     */
    readonly execute: (
      paths: Paths,
      configuration: Configuration,
    ) => Effect.Effect<Reported>;
  }
>()("@cota/cli/ReportTitles") {}

/** A first run reads only the transcripts changed within this long, which hold the sessions the hub shows lately. */
const recentDays = 14;

/** How long the hub is given to answer a batch. */
const batchDeadline = "30 seconds";

const sendProblem = (
  hub: string,
  error: HubUnreachable | HubKeyUnknown | HubFailed,
) => {
  const later = "the titles not sent are sent by the next run";
  switch (error._tag) {
    case "HubUnreachable":
      return `${hub} could not be reached within ${batchDeadline}; ${later}`;
    case "HubKeyUnknown":
      return `${hub} does not know this machine's hub key. Join again: cota join ${hub}`;
    case "HubFailed":
      return `${hub} answered ${error.status ?? "what cota does not read"} to the titles; ${later}`;
  }
};

/** The reporter over a batch size: the hub's limit, or a smaller one for the laws. */
export const layerOf = (
  batchSize: number,
): Layer.Layer<
  ReportTitles,
  never,
  Environment | Files | TitleSources | TitleReports | ReadHubKeys
> =>
  Layer.effect(
    ReportTitles,
    Effect.gen(function* () {
      const { system, variables } = yield* Environment;
      const files = yield* Files;
      const sources = yield* TitleSources;
      const reports = yield* TitleReports;
      const readHubKeys = yield* ReadHubKeys;

      const readTranscripts = Effect.fn(function* (
        projects: string,
        kept: ReadonlyMap<string, Titles.Transcript>,
        first: boolean,
        now: DateTime.Utc,
        problems: Array<string>,
      ) {
        const listed = yield* Effect.result(sources.transcripts(projects));
        if (Result.isFailure(listed)) {
          problems.push(
            `${listed.failure.path} cannot be read: ${listed.failure.reason}`,
          );
          return kept;
        }
        const cutoff = DateTime.toEpochMillis(
          DateTime.subtract(now, { days: recentDays }),
        );
        const read = new Map<string, Titles.Transcript>();
        for (const file of listed.success) {
          const before = kept.get(file.path);
          if (before === undefined && first && file.changedAt < cutoff) {
            continue;
          }
          const from = Titles.resumed(
            before ?? Titles.unreadTranscript,
            Titles.unreadTranscript,
            file.size,
          );
          if (file.size === from.offset) {
            read.set(file.path, from);
            continue;
          }
          const bytes = yield* Effect.result(
            sources.bytesFrom(file.path, from.offset),
          );
          if (Result.isFailure(bytes)) {
            problems.push(
              `${bytes.failure.path} cannot be read: ${bytes.failure.reason}`,
            );
            if (before !== undefined) read.set(file.path, before);
            continue;
          }
          if (Option.isSome(bytes.success)) {
            read.set(
              file.path,
              Titles.readTranscript(from, bytes.success.value),
            );
          }
        }
        return read;
      });

      const readCodex = Effect.fn(function* (
        index: string,
        kept: Titles.CodexIndex,
        problems: Array<string>,
      ) {
        const failed = (path: string, reason: string) => {
          problems.push(`${path} cannot be read: ${reason}`);
          return kept;
        };
        const file = yield* Effect.result(sources.file(index));
        if (Result.isFailure(file)) {
          return failed(file.failure.path, file.failure.reason);
        }
        if (Option.isNone(file.success)) return Titles.unreadIndex;
        const from = Titles.resumed(
          kept,
          Titles.unreadIndex,
          file.success.value.size,
        );
        const bytes = yield* Effect.result(
          sources.bytesFrom(index, from.offset),
        );
        if (Result.isFailure(bytes)) {
          return failed(bytes.failure.path, bytes.failure.reason);
        }
        return Option.match(bytes.success, {
          onNone: () => Titles.unreadIndex,
          onSome: (read) => Titles.readIndex(from, read),
        });
      });

      const readT3 = Effect.fn(function* (
        database: string,
        problems: Array<string>,
      ) {
        const rows = yield* Effect.result(sources.threadTitles(database));
        if (Result.isFailure(rows)) {
          problems.push(
            `${rows.failure.source} cannot be read: ${rows.failure.reason}`,
          );
          return new Map<string, string>();
        }
        return new Map(Option.getOrElse(rows.success, () => []));
      });

      return ReportTitles.of({
        execute: Effect.fn("ReportTitles.execute")(function* (
          paths: Paths,
          configuration: Configuration,
        ) {
          const now = yield* DateTime.now;
          const { hub, machine } = configuration;
          const problems: Array<string> = [];
          let kept = 0;

          const save = Effect.fn(function* (state: Titles.State) {
            const saved = yield* Effect.result(
              Effect.andThen(
                files.makeDirectory(paths.state, 0o700),
                files.write(titlesFile(paths), Titles.textOf(state), 0o600),
              ),
            );
            if (Result.isFailure(saved)) {
              problems.push(
                `${saved.failure.path} cannot be written: ${saved.failure.reason}`,
              );
            }
            return Result.isSuccess(saved);
          });

          const ended = Effect.gen(function* () {
            const errorFile = titlesErrorFile(paths);
            const done =
              problems.length === 0
                ? Effect.asVoid(files.remove(errorFile))
                : Effect.andThen(
                    files.makeDirectory(paths.state, 0o700),
                    files.write(
                      errorFile,
                      `${DateTime.formatIso(now)} ${problems.join("; ")}\n`,
                      0o600,
                    ),
                  );
            const written = yield* Effect.result(done);
            if (Result.isFailure(written)) {
              problems.push(
                `${written.failure.path} cannot be written: ${written.failure.reason}`,
              );
            }
            return { kept, problems };
          });

          const located = Titles.sourcesOf(system, variables);
          if (Result.isFailure(located)) {
            problems.push(
              `where the clients' files are cannot be known: ${located.failure.variable} is not set`,
            );
            return yield* ended;
          }
          const where = located.success;
          const before = Option.flatMap(
            yield* files
              .read(titlesFile(paths))
              .pipe(Effect.orElseSucceed(() => Option.none<string>())),
            Titles.stateOf,
          );
          const transcripts = yield* readTranscripts(
            where.projects,
            Option.match(before, {
              onNone: () => new Map(),
              onSome: (state) => state.transcripts,
            }),
            Option.isNone(before),
            now,
            problems,
          );
          const codex = yield* readCodex(
            where.codexIndex,
            Option.match(before, {
              onNone: () => Titles.unreadIndex,
              onSome: (state) => state.codex,
            }),
            problems,
          );
          const t3 = yield* readT3(where.t3Database, problems);
          const titles = Titles.titlesOf({ t3, transcripts, codex });
          let state: Titles.State = {
            ranAt: now,
            goodAt: Option.flatMap(before, (each) => each.goodAt),
            transcripts,
            codex,
            sent: Titles.stillSent(
              Option.match(before, {
                onNone: () => new Map(),
                onSome: (each) => each.sent,
              }),
              titles,
            ),
          };
          if (!(yield* save(state))) return yield* ended;

          const keys = yield* Effect.result(readHubKeys.execute(paths));
          if (Result.isFailure(keys)) {
            problems.push(
              `${keys.failure.path} cannot be read: ${keys.failure.reason}`,
            );
            return yield* ended;
          }
          const key = Option.orElse(
            keys.success.subscription,
            () => keys.success.keyed,
          );
          if (Option.isNone(key)) {
            problems.push(
              `this machine keeps no hub key to send titles with. Join again: cota join ${hub}`,
            );
            return yield* ended;
          }
          for (const batch of Titles.batchesOf(titles, state.sent, batchSize)) {
            const sent = yield* Effect.result(
              reports.send(hub, key.value, machine, batch).pipe(
                Effect.timeoutOrElse({
                  duration: batchDeadline,
                  orElse: () => Effect.fail(new HubUnreachable()),
                }),
              ),
            );
            if (Result.isFailure(sent)) {
              problems.push(sendProblem(hub, sent.failure));
              break;
            }
            kept += batch.size;
            state = { ...state, sent: Titles.keptAfter(state.sent, batch) };
            if (!(yield* save(state))) break;
          }
          if (problems.length === 0) {
            yield* save({ ...state, goodAt: Option.some(now) });
          }
          return yield* ended;
        }),
      });
    }),
  );

export const layer = layerOf(Titles.batchSize);
