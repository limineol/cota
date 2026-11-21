import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from "effect/http-api";
import {
  Key,
  Kind,
  Name,
  Source,
} from "#modules/display-names/03-domain/display-name.ts";
import {
  CallerMiddleware,
  mayCall,
} from "#shared/01-presentation/caller.middleware.ts";
import { JsonBody } from "#shared/01-presentation/json-body.middleware.ts";

export class NoSuchDisplayNameProblem extends HttpApiError.Problem<NoSuchDisplayNameProblem>()(
  "NoSuchDisplayNameProblem",
  {
    type: "urn:cota:no-such-display-name",
    status: 404,
    title: "The owner has no name for that key.",
  },
) {}

export const DisplayName = Schema.Struct({
  kind: Kind,
  key: Schema.String,
  name: Schema.String,
  source: Source,
}).annotate({ identifier: "DisplayName" });

const params = { kind: Kind, key: Key };

const list = HttpApiEndpoint.get("list", "/display-names", {
  success: Schema.Struct({ names: Schema.Array(DisplayName) }),
}).annotateMerge(mayCall("reader"));

const set = HttpApiEndpoint.put("set", "/display-names/:kind/:key", {
  params,
  payload: Schema.Struct({ name: Name }),
  success: DisplayName,
}).annotateMerge(mayCall("owner"));

const remove = HttpApiEndpoint.delete("remove", "/display-names/:kind/:key", {
  params,
  success: HttpApiSchema.NoContent,
  error: NoSuchDisplayNameProblem,
}).annotateMerge(mayCall("owner"));

/** The owner's names for pools, models, clients, machines and projects (`docs/specs/display-names/spec.md`). */
export const group = HttpApiGroup.make("display-names")
  .add(list, set, remove)
  .middleware(CallerMiddleware)
  .middleware(JsonBody)
  .middleware(HttpApiMiddleware.ProblemDetails)
  .prefix("/api");
