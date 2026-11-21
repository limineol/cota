import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
} from "effect/http-api";
import { Kind, Scope } from "#modules/admission/03-domain/admission.ts";
import {
  CallerMiddleware,
  mayCall,
} from "#shared/01-presentation/caller.middleware.ts";
import { JsonBody } from "#shared/01-presentation/json-body.middleware.ts";
import { Money } from "#shared/01-presentation/money.ts";
import { HubStoreProblem } from "#shared/01-presentation/problems.ts";
import { ProtocolName } from "#shared/03-domain/protocol-name.ts";

const Tokens = Schema.Int.check(Schema.isGreaterThan(0));

/** Each class's rate in dollars per million tokens. */
export const ModelRates = Schema.Struct({
  input: Money,
  cacheRead: Money,
  cacheWriteShort: Money,
  cacheWriteLong: Money,
  output: Money,
}).annotate({ identifier: "ModelRates" });

export const ModelPrice = Schema.Struct({
  base: ModelRates,
  tiers: Schema.Array(
    Schema.Struct({
      threshold: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      rates: ModelRates,
    }),
  ),
}).annotate({ identifier: "ModelPrice" });

export const MachineModel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  contextTokens: Schema.NullOr(Tokens),
  outputTokens: Schema.NullOr(Tokens),
  imageInput: Schema.NullOr(Schema.Boolean),
  price: ModelPrice,
}).annotate({ identifier: "MachineModel" });

export const MachinePool = Schema.Struct({
  id: Schema.String,
  kind: Kind,
  protocol: ProtocolName,
  provider: Schema.String,
  displayName: Schema.NullOr(Schema.String),
  models: Schema.Array(MachineModel),
}).annotate({ identifier: "MachinePool" });

export const Machine = Schema.Struct({
  hubKey: Schema.NullOr(Schema.Struct({ name: Schema.String, scope: Scope })),
  pools: Schema.Array(MachinePool),
}).annotate({ identifier: "Machine" });

const read = HttpApiEndpoint.get("read", "/machine", {
  success: Machine,
  error: HubStoreProblem,
}).annotateMerge(mayCall("any-hub-key"));

/** What the caller is and the pools it opens, for a machine (`docs/specs/api/spec.md`, Machine). */
export const group = HttpApiGroup.make("machine")
  .add(read)
  .middleware(CallerMiddleware)
  .middleware(JsonBody)
  .middleware(HttpApiMiddleware.ProblemDetails)
  .prefix("/api");
