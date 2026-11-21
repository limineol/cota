import { Context, Layer, Option } from "effect";
import * as Client from "#shared/03-domain/client.ts";
import type { DisplayName, Kind } from "./display-name.ts";

/** The names the hub gives ids itself: the clients it knows, and the models of the price lists it ships. */
export class BuiltInNames extends Context.Service<
  BuiltInNames,
  {
    readonly all: ReadonlyArray<DisplayName>;
    readonly of: (kind: Kind, key: string) => Option.Option<DisplayName>;
  }
>()("@cota/hub/display-names/BuiltInNames") {}

/** The clients' names, and the given models' names, by model id. */
export const layer = (
  models: ReadonlyMap<string, string>,
): Layer.Layer<BuiltInNames> => {
  const all: ReadonlyArray<DisplayName> = [
    ...Client.names.map(
      ([key, name]): DisplayName => ({
        kind: "client",
        key,
        name,
        source: "built-in",
      }),
    ),
    ...[...models].map(
      ([key, name]): DisplayName => ({
        kind: "model",
        key,
        name,
        source: "built-in",
      }),
    ),
  ];
  return Layer.succeed(
    BuiltInNames,
    BuiltInNames.of({
      all,
      of: (kind, key) =>
        Option.fromUndefinedOr(
          all.find((name) => name.kind === kind && name.key === key),
        ),
    }),
  );
};
