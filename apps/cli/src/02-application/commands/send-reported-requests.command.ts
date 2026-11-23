import {
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  type Redacted,
  Result,
} from "effect";
import {
  ClientRecords,
  type Listed,
} from "#02-application/interfaces/client-records.ts";
import { Files } from "#02-application/interfaces/files.ts";
import {
  type ReportRefused,
  RequestReports,
} from "#02-application/interfaces/request-reports.ts";
import { RunLock } from "#02-application/interfaces/run-lock.ts";
import { ReadHubKeys } from "#02-application/queries/read-hub-keys.query.ts";
import { ReadProject } from "#02-application/queries/read-project.query.ts";
import {
  type ModelCall,
  type Reading,
  readAfter,
  readingOf,
} from "#03-domain/antigravity-record.ts";
import type {
  Configuration,
  ReportedFolder,
} from "#03-domain/configuration.ts";
import type { HubAddress } from "#03-domain/hub-address.ts";
import {
  type HubFailed,
  type HubKeyUnknown,
  HubUnreachable,
} from "#03-domain/machine.ts";
import {
  type Paths,
  requestsErrorFile,
  requestsFile,
  requestsLockFile,
  requestsScratch,
} from "#03-domain/paths.ts";
import * as Requests from "#03-domain/requests.ts";

/** What a run did: how many calls the hub stored and already held, whether another run held the lock, and each problem, one sentence each. */
export interface Sent {
  readonly stored: number;
  readonly held: number;
  readonly busy: boolean;
  readonly problems: ReadonlyArray<string>;
}

export class SendReportedRequests extends Context.Service<
  SendReportedRequests,
  {
    /**
     * One run of the request reporter (`docs/specs/request-reporter/spec.md`,
     * `cota requests report`): reads each kept folder's conversations that
     * are due, sends their new model calls in reports, moving each report
     * cursor on the hub's answer that they are stored, and writes
     * `requests.error` when it had a problem, or removes it.
     */
    readonly execute: (
      paths: Paths,
      configuration: Configuration,
    ) => Effect.Effect<Sent>;
  }
>()("@cota/cli/SendReportedRequests") {}

/** How long the hub is given to answer a report. */
const reportDeadline = "120 seconds";

type SendFailure = HubUnreachable | HubKeyUnknown | ReportRefused | HubFailed;

const sendProblem = (
  hub: HubAddress,
  { folder, pool }: ReportedFolder,
  error: SendFailure,
) => {
  const later = "the calls not stored are sent by the next run";
  switch (error._tag) {
    case "HubUnreachable":
      return `${hub} could not be reached within ${reportDeadline}; ${later}`;
    case "HubKeyUnknown":
      return `${hub} does not know this machine's hub key. Join again: cota join ${hub}`;
    case "HubFailed":
      return `${hub} answered ${error.status ?? "what cota does not read"} to a report of ${folder}; ${later}`;
    case "ReportRefused":
      if (error.type === "urn:cota:report-out-of-order") {
        return `${hub} does not hold the calls the report cursors of ${folder} say it stored (report-out-of-order): cota requests remove antigravity '${folder}', then cota requests add antigravity '${folder}' ${pool}, reports the folder again`;
      }
      if (
        error.type === "urn:cota:pool-not-observed" ||
        error.type === "urn:cota:no-such-pool"
      ) {
        return `${hub} refused the pool ${pool} of ${folder}: ${error.detail}. cota requests add antigravity '${folder}' <pool> names an observed pool`;
      }
      return `${hub} answered ${error.status} to a report of ${folder}: ${error.detail === "" ? error.type : error.detail}; ${later}`;
  }
};

/** A conversation read this run: its cursor, the stamps of its files, its reading and each call written out. */
interface Read {
  readonly conversation: string;
  cursor: Requests.ReportCursor;
  readonly stamps: Requests.Stamps;
  readonly reading: Reading;
  readonly written: ReadonlyArray<string>;
  stored: number;
}

/** A call read, written out, in the conversation it was read from. */
interface Entry {
  readonly read: Read;
  readonly call: ModelCall;
  readonly written: string;
}

const entriesOf = (read: Read): ReadonlyArray<Entry> =>
  read.written.flatMap((written, index) => {
    const call = read.reading.calls[index];
    return call === undefined ? [] : [{ read, call, written }];
  });

const entriesAt = (
  entries: ReadonlyArray<Entry>,
  batch: ReadonlyArray<number>,
): ReadonlyArray<Entry> =>
  batch.flatMap((at) => {
    const entry = entries[at];
    return entry === undefined ? [] : [entry];
  });

/** The run over the limits of a report: the hub's, or smaller ones for the laws. */
export const layerOf = (
  given: Requests.Limits,
): Layer.Layer<
  SendReportedRequests,
  never,
  Files | ClientRecords | RequestReports | RunLock | ReadHubKeys | ReadProject
> =>
  Layer.effect(
    SendReportedRequests,
    Effect.gen(function* () {
      const files = yield* Files;
      const records = yield* ClientRecords;
      const reports = yield* RequestReports;
      const lock = yield* RunLock;
      const readHubKeys = yield* ReadHubKeys;
      const readProject = yield* ReadProject;

      const projectsOf = Effect.fn(function* (
        calls: ReadonlyArray<ModelCall>,
        known: Map<string, string>,
      ) {
        const projects: Array<string> = [];
        for (const call of calls) {
          if (Option.isNone(call.workspace)) {
            projects.push("");
            continue;
          }
          const workspace = call.workspace.value;
          const kept = known.get(workspace);
          const project = kept ?? (yield* readProject.ofDirectory(workspace));
          known.set(workspace, project);
          projects.push(project);
        }
        return projects;
      });

      const readConversation = Effect.fn(function* (
        folder: string,
        pool: string,
        listed: Listed,
        cursor: Requests.ReportCursor,
        scratch: string,
        now: number,
        known: Map<string, string>,
      ) {
        if (
          Option.exists(
            cursor.stamps,
            (kept) => listed.stamps.db.size < kept.db.size,
          )
        ) {
          const reading: Reading = {
            calls: [],
            stopped: Option.some({ reason: "rewritten", step: Option.none() }),
            waiting: false,
            next: cursor.from,
          };
          return Option.some<Read>({
            conversation: listed.conversation,
            cursor,
            stamps: listed.stamps,
            reading,
            written: [],
            stored: 0,
          });
        }
        const copied = yield* records.read(
          folder,
          listed.conversation,
          scratch,
          readAfter(cursor.from),
        );
        if (copied._tag === "Changing") return Option.none<Read>();
        if (copied._tag === "Schema") {
          return Option.some<Read>({
            conversation: listed.conversation,
            cursor,
            stamps: listed.stamps,
            reading: {
              calls: [],
              stopped: Option.some({ reason: "schema", step: Option.none() }),
              waiting: false,
              next: cursor.from,
            },
            written: [],
            stored: 0,
          });
        }
        const settled = Requests.isSettled(cursor, copied.stamps, now);
        const reading = readingOf(copied.record, cursor.from, settled);
        const projects = yield* projectsOf(reading.calls, known);
        const written = reading.calls.map((call, index) =>
          JSON.stringify(Requests.wireCallOf(call, projects[index] ?? "")),
        );
        const tooLarge = written.findIndex((each) =>
          Requests.isTooLarge(pool, each, given),
        );
        const cut = reading.calls[tooLarge];
        return Option.some<Read>({
          conversation: listed.conversation,
          cursor,
          stamps: copied.stamps,
          reading:
            cut === undefined
              ? reading
              : {
                  calls: reading.calls.slice(0, tooLarge),
                  stopped: Option.some({
                    reason: "too-large",
                    step: Option.some(cut.step),
                  }),
                  waiting: false,
                  next: reading.calls[tooLarge - 1]?.next ?? cursor.from,
                },
          written: cut === undefined ? written : written.slice(0, tooLarge),
          stored: 0,
        });
      });

      return SendReportedRequests.of({
        execute: Effect.fn("SendReportedRequests.execute")(function* (
          paths: Paths,
          configuration: Configuration,
        ) {
          const { hub, machine } = configuration;
          const problems: Array<string> = [];
          let stored = 0;
          let held = 0;
          const folders = configuration.clients?.antigravity?.reported ?? [];

          const ended = Effect.gen(function* () {
            const errorFile = requestsErrorFile(paths);
            const at = DateTime.formatIso(yield* DateTime.now);
            const done =
              problems.length === 0
                ? Effect.asVoid(files.remove(errorFile))
                : Effect.andThen(
                    files.makeDirectory(paths.state, 0o700),
                    files.write(
                      errorFile,
                      `${at} ${problems.join("; ")}\n`,
                      0o600,
                    ),
                  );
            const written = yield* Effect.result(done);
            if (Result.isFailure(written)) {
              problems.push(
                `${written.failure.path} cannot be written: ${written.failure.reason}`,
              );
            }
            return { stored, held, busy: false, problems };
          });

          const lockFile = requestsLockFile(paths);
          const taken = yield* Effect.result(
            Effect.andThen(
              files.makeDirectory(paths.state, 0o700),
              lock.take(lockFile),
            ),
          );
          if (Result.isFailure(taken)) {
            problems.push(
              `${taken.failure.path} cannot be written: ${taken.failure.reason}`,
            );
            return yield* ended;
          }
          if (!taken.success) {
            return { stored, held, busy: true, problems };
          }

          return yield* Effect.gen(function* () {
            const stateFile = requestsFile(paths);
            const text = yield* Effect.result(files.read(stateFile));
            const before = Result.isFailure(text)
              ? Option.none<Requests.State>()
              : Requests.stateOf(text.success);
            if (Option.isNone(before)) {
              problems.push(
                `${stateFile} does not read; nothing was reported. cota requests remove and add each folder to start again`,
              );
              return yield* ended;
            }
            const state = new Map<string, Requests.FolderState>();
            const save = Effect.fn(function* () {
              const saved = yield* Effect.result(
                files.write(stateFile, Requests.textOf(state), 0o600),
              );
              if (Result.isFailure(saved)) {
                problems.push(
                  `${saved.failure.path} cannot be written: ${saved.failure.reason}`,
                );
              }
              return Result.isSuccess(saved);
            });
            for (const { folder } of folders) {
              state.set(
                folder,
                before.value.get(folder) ?? Requests.unreadFolder,
              );
            }
            if (folders.length === 0) {
              yield* save();
              return yield* ended;
            }

            const keys = yield* Effect.result(readHubKeys.execute(paths));
            const key: Option.Option<Redacted.Redacted<string>> =
              Result.isFailure(keys)
                ? Option.none()
                : Option.orElse(
                    keys.success.subscription,
                    () => keys.success.keyed,
                  );
            if (Option.isNone(key)) {
              problems.push(
                Result.isFailure(keys)
                  ? `${keys.failure.path} cannot be read: ${keys.failure.reason}`
                  : `this machine keeps no hub key to report with. Join again: cota join ${hub}`,
              );
              return yield* ended;
            }

            const scratch = requestsScratch(paths);
            const known = new Map<string, string>();
            for (const kept of folders) {
              const { folder, pool } = kept;
              const started = yield* DateTime.now;
              const now = DateTime.toEpochMillis(started);
              const through = DateTime.formatIso(started);
              const folderProblems = problems.length;
              const folderState = state.get(folder) ?? Requests.unreadFolder;
              const cursors = new Map(folderState.conversations);
              let complete = true;
              let sentThrough = false;
              let stopRun = false;
              let stopFolder = false;
              /** Conversations read whose calls are not all stored yet. */
              const open: Array<Read> = [];
              /** Calls read that do not yet fill a report, sent with the next conversation's or last. */
              let pending: ReadonlyArray<Entry> = [];

              const report = Effect.fn(function* (
                batch: ReadonlyArray<Entry>,
                last: boolean,
              ) {
                const body = Requests.bodyOf(
                  pool,
                  last ? Option.some(through) : Option.none(),
                  batch.map((entry) => entry.written),
                );
                const answer = yield* Effect.result(
                  reports.send(hub, key.value, machine, body, scratch).pipe(
                    Effect.timeoutOrElse({
                      duration: reportDeadline,
                      orElse: () => Effect.fail(new HubUnreachable()),
                    }),
                  ),
                );
                if (Result.isFailure(answer)) {
                  problems.push(sendProblem(hub, kept, answer.failure));
                  stopRun =
                    answer.failure._tag === "HubUnreachable" ||
                    answer.failure._tag === "HubKeyUnknown";
                  return false;
                }
                stored += answer.success.stored;
                held += answer.success.held;
                if (last) sentThrough = true;
                for (const { read, call } of batch) {
                  read.cursor = { ...read.cursor, from: call.next };
                  read.stored += 1;
                  cursors.set(read.conversation, read.cursor);
                }
                state.set(folder, { ...folderState, conversations: cursors });
                return yield* save();
              });

              /** Moves the cursor of each conversation every call of which is stored past what it read. */
              const settle = () => {
                for (const read of open.splice(0)) {
                  const unsent = read.stored < read.reading.calls.length;
                  if (unsent) open.push(read);
                  else {
                    cursors.set(
                      read.conversation,
                      Requests.cursorAfter(
                        read.cursor,
                        read.stamps,
                        read.reading,
                        now,
                      ),
                    );
                  }
                }
              };

              const listed = yield* Effect.result(
                records.conversations(folder),
              );
              if (Result.isFailure(listed)) {
                problems.push(
                  `${listed.failure.path} cannot be read: ${listed.failure.reason}`,
                );
                complete = false;
              } else if (Option.isNone(listed.success)) {
                problems.push(
                  `${folder} does not exist. cota requests remove antigravity '${folder}' forgets it`,
                );
                complete = false;
              } else {
                const names = new Set(
                  listed.success.value.map((each) => each.conversation),
                );
                for (const id of cursors.keys()) {
                  if (!names.has(id)) cursors.delete(id);
                }
                // One conversation at a time: what of it fills reports is
                // sent, and its cursors kept, before the next is read.
                for (const each of listed.success.value) {
                  if (stopFolder) break;
                  const cursor = Option.fromUndefinedOr(
                    cursors.get(each.conversation),
                  );
                  if (!Requests.isDue(cursor, each.stamps)) continue;
                  const read = yield* Effect.result(
                    readConversation(
                      folder,
                      pool,
                      each,
                      Option.getOrElse(cursor, () => Requests.firstCursor),
                      scratch,
                      now,
                      known,
                    ),
                  );
                  if (Result.isFailure(read)) {
                    problems.push(
                      `${read.failure.path} cannot be read: ${read.failure.reason}`,
                    );
                    complete = false;
                    continue;
                  }
                  if (Option.isNone(read.success)) {
                    complete = false;
                    continue;
                  }
                  const fresh = read.success.value;
                  open.push(fresh);
                  const entries = [...pending, ...entriesOf(fresh)];
                  const batches = Requests.reportsOf(
                    pool,
                    entries.map((entry) => entry.written),
                    given,
                  ).map((batch) => entriesAt(entries, batch));
                  pending = batches.at(-1) ?? [];
                  for (const batch of batches.slice(0, -1)) {
                    if (!(yield* report(batch, false))) {
                      stopFolder = true;
                      break;
                    }
                  }
                  settle();
                }
              }
              if (!stopFolder && (complete || pending.length > 0)) {
                yield* report(pending, complete);
              }
              settle();
              const good = problems.length === folderProblems;
              const ranAt = DateTime.formatIso(yield* DateTime.now);
              state.set(folder, {
                ranAt: Option.some(ranAt),
                goodAt: good ? Option.some(ranAt) : folderState.goodAt,
                through: sentThrough
                  ? Option.some(through)
                  : folderState.through,
                conversations: cursors,
              });
              if (!(yield* save()) || stopRun) break;
            }
            return yield* ended;
          }).pipe(Effect.ensuring(lock.release(lockFile)));
        }),
      });
    }),
  );

export const layer = layerOf(Requests.limits);
