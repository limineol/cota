import { parseArgs } from "node:util";
import { BunHttpClient, BunRuntime } from "@effect/platform-bun";
import { Console, Effect, HashMap, Layer, Option, Schema } from "effect";
import * as HubConfig from "#config/config.ts";
import { storeSteps } from "#hub.ts";
import { SetDisplayName } from "#modules/display-names/02-application/commands/set-display-name.command.ts";
import { ListDisplayNames } from "#modules/display-names/02-application/queries/list-display-names.query.ts";
import * as DisplayNames from "#modules/display-names/module.ts";
import * as ImportDays from "#modules/request-log/02-application/commands/import-days.command.ts";
import {
  type Counted,
  ImportFiles,
} from "#modules/request-log/02-application/interfaces/import-source.ts";
import * as Archive from "#modules/request-log/03-domain/archive.ts";
import * as Import from "#modules/request-log/03-domain/import.ts";
import * as ClickHouseImportSource from "#modules/request-log/04-infrastructure/import-source/clickhouse-import-source.ts";
import * as ImportFilesReader from "#modules/request-log/04-infrastructure/import-source/import-files.ts";
import * as ClickHouseRequestLogArchive from "#modules/request-log/04-infrastructure/persistence/clickhouse/clickhouse-request-log-archive.ts";
import * as ClickHouse from "#modules/request-log/04-infrastructure/persistence/clickhouse/client.ts";
import * as PriceLists from "#modules/request-log/04-infrastructure/prices/prices.ts";
import * as RequestLog from "#modules/request-log/module.ts";
import * as HubStore from "#shared/04-infrastructure/hub-store/hub-store.ts";

const usage =
  "Usage: COTA_CONFIG=<configuration> bun run import <import file> [--dry-run] [--from <YYYY-MM-DD>] [--to <YYYY-MM-DD>]\nRun one import at a time, and not beside a restore.";

class Stop extends Schema.TaggedError<
  Stop,
  { readonly brand: unique symbol }
>()("Stop", { message: Schema.String, code: Schema.Literals([1, 2]) }) {}

const stop = (message: string, code: 1 | 2 = 2) =>
  Effect.fail(new Stop({ message, code }));

const dayOf = (given: string | undefined) =>
  given === undefined
    ? Effect.succeed(Option.none<Archive.Day>())
    : Schema.decodeEffect(Archive.Day)(given).pipe(
        Effect.asSome,
        Effect.mapError(() => new Stop({ message: usage, code: 2 })),
      );

const optionsOf = Effect.fn("optionsOf")(function* (
  args: ReadonlyArray<string>,
) {
  const parsed = yield* Effect.try({
    try: () =>
      parseArgs({
        args: [...args],
        options: {
          from: { type: "string" },
          to: { type: "string" },
          "dry-run": { type: "boolean" },
        },
        allowPositionals: true,
        strict: true,
      }),
    catch: () => new Stop({ message: usage, code: 2 }),
  });
  const [file, ...more] = parsed.positionals;
  if (file === undefined || file === "" || more.length > 0) {
    return yield* stop(usage);
  }
  const from = yield* dayOf(parsed.values.from);
  const to = yield* dayOf(parsed.values.to);
  if (Option.isSome(from) && Option.isSome(to) && from.value > to.value) {
    return yield* stop(usage);
  }
  return {
    file,
    range: { from, to },
    dryRun: parsed.values["dry-run"] === true,
  };
});

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;

const dollars = (amount: number) =>
  `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const picodollarsPerDollar = 10 ** 12;

const seconds = (millis: number) => `${(millis / 1000).toFixed(1)} s`;

const notCarriedText = (notCarried: ImportDays.NotCarried) =>
  [
    [
      notCarried.conversations,
      "conversation",
      "conversations",
      "their items are not in the source",
    ],
    [notCarried.usages, "usage", "usages", "they do not add up"],
    [
      notCarried.requestItems,
      "request item",
      "request items",
      "their request is not in the source's log",
    ],
    [notCarried.items, "item", "items", "no imported request names them"],
    [notCarried.unreadable, "item", "items", "their content is not JSON"],
  ]
    .filter(([count]) => count !== 0)
    .map(
      ([count, one, many, why]) =>
        `${plural(Number(count), String(one), String(many))} (${why})`,
    )
    .join(", ");

const lineOf = (
  day: Archive.Day,
  imported: ImportDays.Imported,
  dryRun: boolean,
): string => {
  switch (imported._tag) {
    case "Added": {
      const { items, request_items, requests, session_titles } = imported.added;
      const notCarried = notCarriedText(imported.notCarried);
      return `${day}: ${dryRun ? "would add" : "added"} ${plural(requests, "request", "requests")}, ${plural(items, "item", "items")}, ${plural(request_items, "request item", "request items")} and ${plural(session_titles, "title", "titles")}; cost ${dollars(Number(imported.cost) / picodollarsPerDollar)} (the source recorded ${dollars(imported.sourceCost)})${notCarried === "" ? "" : `; not carried: ${notCarried}`}`;
    }
    case "Held":
      return `${day}: already held`;
    case "Failed":
      return `${day}: failed: ${imported.detail}; the rows added before it stay, and running the import again adds the rest`;
  }
};

const timingsOf = (imported: ImportDays.Imported) =>
  imported._tag === "Failed" ? undefined : imported.timings;

const countedText = (counted: Counted) =>
  counted
    .map(
      ([value, count]) =>
        `${value === "" ? "(none)" : value} ${count.toLocaleString("en-US")}`,
    )
    .join(", ");

const mixedText = (mixed: ReadonlyArray<Import.MixedPool>) => {
  const requests = mixed
    .flatMap(({ others }) => others)
    .reduce((sum, [, count]) => sum + count, 0);
  if (requests === 0) return "none";
  return `${requests.toLocaleString("en-US")} (${mixed
    .map(
      ({ pool, provider, others }) =>
        `${pool}, mostly ${provider}: ${countedText(others)}`,
    )
    .join("; ")})`;
};

const neverRecorded =
  "not in the source, for every imported request: the body the client sent, the login's fingerprint, the quota headers, the kept headers and the purpose, the time to the first byte, the body sizes, the service tier, refusals and what was diverted after them, a title's time and machine";

const read = (path: string) =>
  Effect.tryPromise({
    try: () => Bun.file(path).text(),
    catch: () =>
      new Stop({ message: `The import file ${path} cannot be read.`, code: 2 }),
  });

const importing = Effect.gen(function* () {
  const options = yield* optionsOf(process.argv.slice(2));
  const configured = yield* Effect.gen(function* () {
    const { file, text } = yield* HubConfig.read();
    return yield* HubConfig.parseImport(file, text);
  }).pipe(
    Effect.mapError(
      (invalid) => new Stop({ message: invalid.message, code: 2 }),
    ),
  );
  const importFile = yield* HubConfig.parseImportFile(
    options.file,
    yield* read(options.file),
  ).pipe(
    Effect.mapError(
      (invalid) => new Stop({ message: invalid.message, code: 2 }),
    ),
  );

  const pools = new Map<string, Import.Target>();
  for (const [sourcePool, id] of importFile.pools) {
    const pool = HashMap.get(configured.pools, id);
    if (Option.isNone(pool)) {
      return yield* stop(
        `The pool map sends ${sourcePool} to ${id}, which the hub's configuration does not have.`,
      );
    }
    pools.set(sourcePool, {
      id,
      provider: pool.value.provider,
      protocol: pool.value.protocol,
    });
  }
  const targets: Import.Targets = { pools, machines: importFile.machines };

  const importDays = yield* ImportDays.ImportDays.pipe(
    Effect.provide(
      ImportDays.layer.pipe(
        Layer.provide(
          ClickHouseImportSource.layer({
            url: importFile.source.url,
            database: importFile.source.bifrostDatabase,
            user: importFile.source.user,
            password: importFile.source.password,
            bifrostDatabase: importFile.source.bifrostDatabase,
            hubDatabase: importFile.source.hubDatabase,
          }),
        ),
        Layer.provide(
          ImportFilesReader.layer({
            titles: importFile.titles,
            names: importFile.names,
          }),
        ),
        Layer.provide(ClickHouseRequestLogArchive.layer),
        Layer.provide(ClickHouse.layer(configured.clickhouse)),
        Layer.provide(PriceLists.layer(configured.pools)),
        Layer.provide(BunHttpClient.layer),
      ),
    ),
  );
  const names = yield* (yield* ImportFiles.pipe(
    Effect.provide(
      ImportFilesReader.layer({
        titles: Option.none(),
        names: importFile.names,
      }),
    ),
  )).names.pipe(
    Effect.mapError(({ detail }) => new Stop({ message: detail, code: 2 })),
  );

  // The hub store, opened only for a names file, and never migrated.
  const store = Option.map(importFile.names, () =>
    DisplayNames.layer({ models: RequestLog.modelNames }).pipe(
      Layer.provide(
        HubStore.migrated({ path: configured.store.path, steps: storeSteps }),
      ),
    ),
  );
  const owners = Option.isNone(store)
    ? new Set<string>()
    : yield* Effect.gen(function* () {
        const listed = yield* (yield* ListDisplayNames).execute;
        return new Set(
          listed
            .filter(({ source }) => source === "owner")
            .map(({ kind, key }) => Import.nameKeyOf(kind, key)),
        );
      }).pipe(
        Effect.provide(store.value),
        Effect.mapError(
          (error) => new Stop({ message: error.message, code: 2 }),
        ),
      );

  const done = yield* importDays
    .execute({ range: options.range, dryRun: options.dryRun, targets })
    .pipe(
      Effect.catchTags({
        ImportRefused: (refused) =>
          options.dryRun && refused.unmapped.length > 0
            ? stop(
                `The pool map does not name: ${countedText(refused.unmapped)}.`,
                1,
              )
            : stop(`The import cannot start: ${refused.why}.`),
        ImportSourceFailed: (failed) =>
          stop(`The source could not be read: ${failed.detail}`),
        RequestLogArchiveFailed: (failed) =>
          stop(`ClickHouse could not be reached: ${failed.detail}`),
      }),
    );

  for (const [day, imported] of done.days) {
    yield* Console.log(lineOf(day, imported, options.dryRun));
  }
  const failed = done.days.some(([, imported]) => imported._tag === "Failed");

  const renames = Import.renamesOf(names, targets, owners);
  let set = 0;
  let nameFailed = false;
  if (!options.dryRun && !failed && Option.isSome(store)) {
    yield* Effect.gen(function* () {
      const setName = yield* SetDisplayName;
      // Read again: a name the owner gave while the days were imported stays.
      const named = new Set(
        (yield* (yield* ListDisplayNames).execute)
          .filter(({ source }) => source === "owner")
          .map(({ kind, key }) => Import.nameKeyOf(kind, key)),
      );
      for (const rename of renames.toSet) {
        if (named.has(Import.nameKeyOf(rename.kind, rename.key))) continue;
        const result = yield* setName.execute(rename).pipe(Effect.result);
        if (result._tag === "Success") set++;
        else nameFailed = true;
      }
    }).pipe(
      Effect.provide(store.value),
      Effect.catch((refused) =>
        Effect.sync(() => {
          nameFailed = true;
          return refused;
        }).pipe(Effect.flatMap((error) => Console.error(error.message))),
      ),
    );
  }
  if (Option.isSome(importFile.names)) {
    const notCarried = renames.notCarried.length;
    yield* Console.log(
      `names: ${options.dryRun ? "would set" : "set"} ${options.dryRun ? renames.toSet.length : set}, already named ${renames.alreadyNamed}${notCarried === 0 ? "" : `; not carried: ${notCarried} (${renames.notCarried.join("; ")})`}`,
    );
  }
  const { withoutRequest, empty } = done.titlesNotCarried;
  if (withoutRequest + empty > 0) {
    yield* Console.log(
      `titles not carried: ${[
        withoutRequest === 0
          ? ""
          : `${plural(withoutRequest, "title", "titles")} (their session has no request)`,
        empty === 0
          ? ""
          : `${plural(empty, "title", "titles")} (they are empty)`,
      ]
        .filter((part) => part !== "")
        .join(", ")}`,
    );
  }
  if (Option.isSome(done.tallies)) {
    const tallies = done.tallies.value;
    yield* Console.log(`pools: ${countedText(tallies.pools)}`);
    yield* Console.log(
      `requests not of their pool's provider: ${mixedText(Import.mixedPoolsOf(tallies.providers, targets))}`,
    );
    yield* Console.log(`machines: ${countedText(tallies.machines)}`);
    yield* Console.log(`user agents: ${countedText(tallies.userAgents)}`);
    yield* Console.log(`statuses: ${countedText(tallies.statuses)}`);
    yield* Console.log(`object types: ${countedText(tallies.objectTypes)}`);
    let total = 0;
    for (const [day, imported] of done.days) {
      const timings = timingsOf(imported);
      if (timings === undefined) continue;
      total += timings.read + timings.build + timings.load;
      yield* Console.log(
        `${day}: read ${seconds(timings.read)}, built ${seconds(timings.build)}, loaded ${seconds(timings.load)}`,
      );
    }
    yield* Console.log(`all days: ${seconds(total)}`);
  }
  yield* Console.log(neverRecorded);
  const count = (tag: ImportDays.Imported["_tag"]) =>
    done.days.filter(([, imported]) => imported._tag === tag).length;
  yield* Console.log(
    `${plural(done.days.length, "day", "days")}: ${count("Added")} ${options.dryRun ? "would be added" : "added"}, ${count("Held")} already held, ${count("Failed")} failed.`,
  );
  return failed || nameFailed ? 1 : 0;
});

const main = Effect.gen(function* () {
  process.exitCode = yield* importing.pipe(
    Effect.catchTag("Stop", ({ message, code }) =>
      Effect.as(Console.error(message), code),
    ),
  );
});

if (import.meta.main) {
  BunRuntime.runMain(main, { disableErrorReporting: true });
}
