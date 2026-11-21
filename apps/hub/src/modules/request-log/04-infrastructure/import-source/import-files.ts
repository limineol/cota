import { Database } from "bun:sqlite";
import { Effect, Layer, Option, Schema } from "effect";
import {
  ImportFiles,
  ImportSourceFailed,
} from "#modules/request-log/02-application/interfaces/import-source.ts";

/** The paths of the prototype dashboard's files, read against the import file's directory. */
export interface FilePaths {
  readonly titles: Option.Option<string>;
  readonly names: Option.Option<string>;
}

const TitleRows = Schema.Array(
  Schema.Struct({ session_id: Schema.String, title: Schema.String }),
);

const failed = (what: string) => (error: unknown) =>
  new ImportSourceFailed({
    detail: `the ${what} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
  });

/** The titles database, opened read-only, and the names file. */
export const layer = (paths: FilePaths): Layer.Layer<ImportFiles> =>
  Layer.succeed(
    ImportFiles,
    ImportFiles.of({
      titles: Option.match(paths.titles, {
        onNone: () => Effect.succeed([]),
        onSome: (path) =>
          Effect.try({
            try: () => {
              const database = new Database(path, {
                readonly: true,
                strict: true,
              });
              try {
                return database
                  .query("SELECT session_id, title FROM titles")
                  .all();
              } finally {
                database.close();
              }
            },
            catch: failed("titles file"),
          }).pipe(
            Effect.flatMap((rows) =>
              Schema.decodeUnknownEffect(TitleRows)(rows).pipe(
                Effect.mapError(failed("titles file")),
              ),
            ),
            Effect.map((rows) =>
              rows.map(({ session_id, title }) => ({
                session: session_id,
                title,
              })),
            ),
          ),
      }),
      names: Option.match(paths.names, {
        onNone: () => Effect.succeed({}),
        onSome: (path) =>
          Effect.tryPromise({
            try: async (): Promise<unknown> =>
              JSON.parse(await Bun.file(path).text()),
            catch: failed("names file"),
          }),
      }),
    }),
  );
