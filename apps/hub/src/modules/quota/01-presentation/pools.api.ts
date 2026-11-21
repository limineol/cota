import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from "effect/http-api";
import { Instant } from "#modules/quota/03-domain/instant.ts";
import { Percentage, WindowSource } from "#modules/quota/03-domain/quota.ts";
import {
  AccountId,
  PlanFact,
  Token,
} from "#modules/quota/03-domain/quota-login.ts";
import {
  CallerMiddleware,
  mayCall,
} from "#shared/01-presentation/caller.middleware.ts";
import { JsonBody } from "#shared/01-presentation/json-body.middleware.ts";
import {
  HubStoreProblem,
  NoSuchPoolProblem,
  RequestLogProblem,
} from "#shared/01-presentation/problems.ts";
import { ProtocolName } from "#shared/03-domain/protocol-name.ts";

export class QuotaLoginNotTakenProblem extends HttpApiError.Problem<QuotaLoginNotTakenProblem>()(
  "QuotaLoginNotTakenProblem",
  {
    type: "urn:cota:quota-login-not-taken",
    status: 400,
    title: "This pool does not take that quota login.",
  },
) {}

export class NoQuotaLoginProblem extends HttpApiError.Problem<NoQuotaLoginProblem>()(
  "NoQuotaLoginProblem",
  {
    type: "urn:cota:no-quota-login",
    status: 404,
    title: "The pool has no quota login.",
  },
) {}

const Time = Schema.DateTimeUtcFromString;
const Milliseconds = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const Pace = Schema.Literals([
  "full",
  "on-pace",
  "in-reserve",
  "ahead-of-pace",
]);

export const Standing = Schema.Struct({
  elapsed: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  resetsInMs: Milliseconds,
  pace: Pace,
  points: Schema.NullOr(Schema.Finite),
  emptiesInMs: Schema.NullOr(Milliseconds),
}).annotate({ identifier: "Standing" });

export const Window = Schema.Struct({
  lengthMs: Schema.Int.check(Schema.isGreaterThan(0)),
  scope: Schema.NullOr(Schema.String),
  source: WindowSource,
  usedPercent: Percentage,
  startsAt: Schema.NullOr(Time),
  resetsAt: Schema.NullOr(Time),
  observedAt: Time,
  standing: Schema.NullOr(Standing),
}).annotate({ identifier: "Window" });

export const Failure = Schema.Struct({
  at: Time,
  kind: Schema.Literals([
    "unreachable",
    "refused",
    "rate-limited",
    "failed",
    "unreadable",
  ]),
  status: Schema.NullOr(Schema.Int),
  detail: Schema.String,
}).annotate({ identifier: "Failure" });

export const Reading = Schema.Struct({
  at: Schema.NullOr(Time),
  failure: Schema.NullOr(Failure),
  nextAttemptAt: Schema.NullOr(Time),
}).annotate({ identifier: "Reading" });

export const QuotaLogin = Schema.Struct({
  provider: Schema.Literals(["anthropic", "chatgpt"]),
  state: Schema.Literals(["none", "active", "expired"]),
  givenAt: Schema.NullOr(Time),
  refreshedAt: Schema.NullOr(Time),
  endsAt: Schema.NullOr(Time),
  expiredAt: Schema.NullOr(Time),
}).annotate({ identifier: "QuotaLogin" });

export const Pool = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["subscription", "keyed"]),
  protocol: ProtocolName,
  provider: Schema.String,
  plan: Schema.NullOr(Schema.String),
  windows: Schema.Array(Window),
  observedAt: Schema.NullOr(Time),
  reading: Schema.NullOr(Reading),
  quotaLogin: Schema.NullOr(QuotaLogin),
}).annotate({ identifier: "Pool" });

const Secret = Schema.RedactedFromValue;

/** A quota login as the owner gives it; its tokens are `Redacted` from here inwards. */
export const GivenQuotaLogin = Schema.Union([
  Schema.Struct({
    provider: Schema.Literal("anthropic"),
    accessToken: Secret(Token),
    refreshToken: Secret(Token),
    endsAt: Instant,
    subscriptionType: Schema.NullOr(PlanFact),
    rateLimitTier: Schema.NullOr(PlanFact),
  }),
  Schema.Struct({
    provider: Schema.Literal("chatgpt"),
    accessToken: Secret(Token),
    refreshToken: Secret(Token),
    accountId: Secret(AccountId),
  }),
]).annotate({ identifier: "GivenQuotaLogin" });

export const Pools = Schema.Struct({ pools: Schema.Array(Pool) });

const params = { pool: Schema.String };

const list = HttpApiEndpoint.get("list", "/pools", {
  success: Pools,
  error: [RequestLogProblem, HubStoreProblem],
}).annotateMerge(mayCall("reader"));

const give = HttpApiEndpoint.put("give", "/pools/:pool/quota-login", {
  params,
  payload: GivenQuotaLogin,
  success: QuotaLogin,
  error: [NoSuchPoolProblem, QuotaLoginNotTakenProblem, HubStoreProblem],
}).annotateMerge(mayCall("owner"));

const forget = HttpApiEndpoint.delete("forget", "/pools/:pool/quota-login", {
  params,
  success: HttpApiSchema.NoContent,
  error: [NoSuchPoolProblem, NoQuotaLoginProblem, HubStoreProblem],
}).annotateMerge(mayCall("owner"));

/** Every pool of the configuration with its quota windows, and its quota login (`docs/specs/api/spec.md`, Pools). */
export const group = HttpApiGroup.make("pools")
  .add(list, give, forget)
  .middleware(CallerMiddleware)
  .middleware(JsonBody)
  .middleware(HttpApiMiddleware.ProblemDetails)
  .prefix("/api");
