import { Effect } from "effect";
import type { HttpApiBuilder } from "effect/http-api";
import { RemoveDisplayName } from "#modules/display-names/02-application/commands/remove-display-name.command.ts";
import { SetDisplayName } from "#modules/display-names/02-application/commands/set-display-name.command.ts";
import { ListDisplayNames } from "#modules/display-names/02-application/queries/list-display-names.query.ts";
import { hubStoreProblem } from "#shared/01-presentation/problems.ts";
import * as DisplayNamesApi from "./display-names.api.ts";

export const build = (
  handlers: HttpApiBuilder.Handlers.FromGroup<typeof DisplayNamesApi.group>,
) =>
  Effect.gen(function* () {
    const listDisplayNames = yield* ListDisplayNames;
    const setDisplayName = yield* SetDisplayName;
    const removeDisplayName = yield* RemoveDisplayName;

    return handlers
      .handle("list", () =>
        listDisplayNames.execute.pipe(
          Effect.map((names) => ({ names })),
          Effect.catchTag("HubStoreUnavailable", hubStoreProblem),
        ),
      )
      .handle("set", ({ params, payload }) =>
        setDisplayName
          .execute({ kind: params.kind, key: params.key, name: payload.name })
          .pipe(Effect.catchTag("HubStoreUnavailable", hubStoreProblem)),
      )
      .handle("remove", ({ params }) =>
        removeDisplayName.execute(params.kind, params.key).pipe(
          Effect.catchTags({
            HubStoreUnavailable: hubStoreProblem,
            NoSuchDisplayName: ({ kind, key }) =>
              Effect.fail(
                new DisplayNamesApi.NoSuchDisplayNameProblem({
                  detail: `The owner has no name for the ${kind} ${JSON.stringify(key)}.`,
                }),
              ),
          }),
        ),
      );
  });
