import { parseArgs } from "node:util";
import { BunHttpClient, BunRuntime } from "@effect/platform-bun";
import { Console, Effect, Layer, Option, Schema } from "effect";
import * as HubConfig from "#config/config.ts";
import * as RestoreArchive from "#modules/request-log/02-application/commands/restore-archive.command.ts";
import { ArchiveDirectory } from "#modules/request-log/02-application/interfaces/archive-directory.ts";
import * as Archive from "#modules/request-log/03-domain/archive.ts";
import * as FileSystemArchiveDirectory from "#modules/request-log/04-infrastructure/archive/file-system-archive-directory.ts";
import * as ClickHouseRequestLogArchive from "#modules/request-log/04-infrastructure/persistence/clickhouse/clickhouse-request-log-archive.ts";
import * as ClickHouse from "#modules/request-log/04-infrastructure/persistence/clickhouse/client.ts";

const usage =
  "Usage: bun run archive:restore <directory> [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>]\nRun one restore at a time.";

class Stop extends Schema.TaggedError<
  Stop,
  { readonly brand: unique symbol }
>()("Stop", { message: Schema.String }) {}

const stop = (message: string) => Effect.fail(new Stop({ message }));

const dayOf = (given: string | undefined) =>
  given === undefined
    ? Effect.succeed(Option.none<Archive.Day>())
    : Schema.decodeUnknownEffect(Archive.Day)(given).pipe(
        Effect.map(Option.some),
        Effect.mapError(() => new Stop({ message: usage })),
      );

const optionsOf = Effect.fn("optionsOf")(function* (
  args: ReadonlyArray<string>,
) {
  const parsed = yield* Effect.try({
    try: () =>
      parseArgs({
        args: [...args],
        options: { from: { type: "string" }, to: { type: "string" } },
        allowPositionals: true,
        strict: true,
      }),
    catch: () => new Stop({ message: usage }),
  });
  const [directory, ...more] = parsed.positionals;
  if (directory === undefined || directory === "" || more.length > 0) {
    return yield* stop(usage);
  }
  const from = yield* dayOf(parsed.values.from);
  const to = yield* dayOf(parsed.values.to);
  if (Option.isSome(from) && Option.isSome(to) && from.value > to.value) {
    return yield* stop(usage);
  }
  return { directory, range: { from, to } };
});

const configOf = Effect.gen(function* () {
  const { file, text } = yield* HubConfig.read();
  return yield* HubConfig.parseClickHouse(file, text);
}).pipe(Effect.mapError((invalid) => new Stop({ message: invalid.message })));

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

const lineOf = (
  day: Archive.Day,
  restored: RestoreArchive.Restored,
): string => {
  switch (restored._tag) {
    case "Added": {
      const { items, request_items, requests, session_titles } = restored.added;
      return `${day}: added ${plural(items, "item", "items")}, ${plural(request_items, "request item", "request items")}, ${plural(requests, "request", "requests")} and ${plural(session_titles, "title", "titles")}`;
    }
    case "Held":
      return `${day}: already held`;
    case "Refused":
      return `${day}: refused: ${restored.why}`;
    case "Failed":
      return `${day}: failed: ${restored.detail}; the rows added before it stay, and running the restore again adds the rest`;
  }
};

const rangeText = ({ from, to }: RestoreArchive.Range) => {
  const first = Option.getOrUndefined(from);
  const last = Option.getOrUndefined(to);
  if (first !== undefined && last !== undefined) {
    return ` from ${first} to ${last}`;
  }
  if (first !== undefined) return ` from ${first}`;
  if (last !== undefined) return ` to ${last}`;
  return "";
};

const restore = Effect.gen(function* () {
  const options = yield* optionsOf(process.argv.slice(2));
  const clickhouse = yield* configOf;
  const restoreArchive = yield* RestoreArchive.RestoreArchive.pipe(
    Effect.provide(
      RestoreArchive.layer.pipe(
        Layer.provide(
          Layer.succeed(
            ArchiveDirectory,
            FileSystemArchiveDirectory.make(options.directory),
          ),
        ),
        Layer.provide(ClickHouseRequestLogArchive.layer),
        Layer.provide(ClickHouse.layer(clickhouse)),
        Layer.provide(BunHttpClient.layer),
      ),
    ),
  );
  const days = yield* restoreArchive.execute(options.range).pipe(
    Effect.catchTags({
      NoArchivedDay: () =>
        stop(
          `No archived day in ${options.directory}${rangeText(options.range)}`,
        ),
      ArchiveDirectoryFailed: (failed) =>
        stop(
          `No archived day in ${options.directory}${rangeText(options.range)}: ${failed.detail}`,
        ),
      RequestLogArchiveFailed: (failed) =>
        stop(`ClickHouse could not be reached: ${failed.detail}`),
    }),
  );
  for (const [day, restored] of days) yield* Console.log(lineOf(day, restored));
  const count = (tag: RestoreArchive.Restored["_tag"]) =>
    days.filter(([, restored]) => restored._tag === tag).length;
  yield* Console.log(
    `${plural(days.length, "day", "days")}: ${count("Added")} restored, ${count("Held")} already held, ${count("Refused")} refused, ${count("Failed")} failed.`,
  );
  return count("Refused") + count("Failed") > 0 ? 1 : 0;
});

const main = Effect.gen(function* () {
  process.exitCode = yield* restore.pipe(
    Effect.catchTag("Stop", ({ message }) =>
      Effect.as(Console.error(message), 2),
    ),
  );
});

if (import.meta.main) {
  BunRuntime.runMain(main, { disableErrorReporting: true });
}
