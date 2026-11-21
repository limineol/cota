import { Context } from "effect";
import { HttpApiMiddleware, OpenApi } from "effect/http-api";
import type { Caller, MayCall as Who } from "#shared/03-domain/caller.ts";
import { Scope } from "#shared/03-domain/hub-key.ts";
import {
  CrossSite,
  HubStoreProblem,
  NotAllowed,
  SignInRequired,
} from "./problems.ts";

/** The caller of the endpoint being answered, as `CallerMiddleware` decided. */
export class CurrentCaller extends Context.Service<CurrentCaller, Caller>()(
  "@cota/hub/api/CurrentCaller",
) {}

/** Who may call an endpoint that declares `CallerMiddleware`; the owner alone unless it says otherwise. */
export const MayCall = Context.Reference<Who>("@cota/hub/api/MayCall", {
  defaultValue: () => "owner",
});

/**
 * Decides once who an API request comes from (`docs/specs/sign-in/spec.md`),
 * answers 401 or 403 when that caller may not call the endpoint, and gives the
 * endpoint its `CurrentCaller`. An endpoint added to a group before the group
 * declares it needs no caller.
 */
export class CallerMiddleware extends HttpApiMiddleware.Service<
  CallerMiddleware,
  { provides: CurrentCaller }
>()("@cota/hub/api/CallerMiddleware", {
  error: [SignInRequired, NotAllowed, CrossSite, HubStoreProblem],
}) {}

const hubKeyRoles =
  "An endpoint's security requirement lists, as its roles, the hub key scopes it admits.";

const securitySchemes = {
  signIn: {
    type: "apiKey",
    name: "cota_sign_in",
    in: "cookie",
    description:
      "The owner's sign-in, from POST /api/sign-in or POST /api/setup.",
  },
  hubKey: {
    type: "apiKey",
    name: "x-cota-key",
    in: "header",
    description: `A hub key. ${hubKeyRoles}`,
  },
  bearer: {
    type: "http",
    scheme: "bearer",
    description: `A hub key as the bearer token. ${hubKeyRoles}`,
  },
} as const;

const scopesOf = {
  reader: ["reader"],
  "any-hub-key": Scope.literals,
} as const;

const securityOf = (who: Who) =>
  who === "owner"
    ? [{ signIn: [] }]
    : [{ signIn: [] }, { hubKey: scopesOf[who] }, { bearer: scopesOf[who] }];

/** The annotations that say who may call an endpoint, for the middleware and for the OpenAPI document. */
export const mayCall = (who: Who): Context.Context<never> =>
  Context.make(MayCall, who).pipe(
    Context.add(OpenApi.Override, { security: securityOf(who) }),
  );

/** Adds the schemes `mayCall` names to an OpenAPI document. */
export const withSecuritySchemes = (
  document: Record<string, unknown>,
): Record<string, unknown> => {
  const components =
    typeof document.components === "object" && document.components !== null
      ? document.components
      : {};
  return { ...document, components: { ...components, securitySchemes } };
};
