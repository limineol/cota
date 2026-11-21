import { Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { Api } from "#api.ts";
import * as DisplayNamesHandlers from "#modules/display-names/01-presentation/display-names.handlers.ts";
import * as RemoveDisplayName from "#modules/display-names/02-application/commands/remove-display-name.command.ts";
import * as SetDisplayName from "#modules/display-names/02-application/commands/set-display-name.command.ts";
import * as ListDisplayNames from "#modules/display-names/02-application/queries/list-display-names.query.ts";
import * as BuiltInNames from "#modules/display-names/03-domain/built-in-names.ts";
import * as SqliteDisplayNames from "#modules/display-names/04-infrastructure/persistence/sqlite/sqlite-display-names.repository.ts";

export interface Options {
  /** The name models.dev gives each model of the shipped price lists, by model id. */
  readonly models: ReadonlyMap<string, string>;
}

/** The display-names module's tables in the hub store. */
export const steps = SqliteDisplayNames.steps;

/** The display-names module's commands and query, over the repository given. */
export const overRepository = (options: Options) =>
  Layer.mergeAll(
    SetDisplayName.layer,
    RemoveDisplayName.layer,
    ListDisplayNames.layer,
  ).pipe(Layer.provide(BuiltInNames.layer(options.models)));

/** The display-names module's commands and query, over the hub store. */
export const layer = (options: Options) =>
  overRepository(options).pipe(Layer.provide(SqliteDisplayNames.layer));

/** The handlers of the `display-names` group. */
export const api = HttpApiBuilder.group(
  Api,
  "display-names",
  DisplayNamesHandlers.build,
);
