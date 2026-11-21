import { Context, Effect, Layer, Option } from "effect";
import { HttpServerRequest } from "effect/http";
import { IdentifyHubKey } from "#modules/admission/02-application/queries/identify-hub-key.query.ts";
import { IdentifyOwner } from "#modules/sign-in/02-application/queries/identify-owner.query.ts";
import * as Access from "#modules/sign-in/03-domain/access.ts";
import {
  CallerMiddleware,
  CurrentCaller,
  MayCall,
} from "#shared/01-presentation/caller.middleware.ts";
import {
  CrossSite,
  hubStoreProblem,
  NotAllowed,
  SignInRequired,
} from "#shared/01-presentation/problems.ts";
import { bearerOf } from "#shared/03-domain/bearer-token.ts";
import type { Caller } from "#shared/03-domain/caller.ts";
import * as SignInCookie from "./sign-in-cookie.ts";

const whoMay = {
  owner: "only the signed-in owner",
  reader: "only a reader key or the owner",
  "any-hub-key": "only a hub key or the owner",
} as const;

/**
 * Who an API request comes from: the first of its sign-in cookies that opens a
 * live sign-in, else the hub key it presents (`docs/specs/sign-in/spec.md`).
 */
export const layer: Layer.Layer<
  CallerMiddleware,
  never,
  IdentifyOwner | IdentifyHubKey
> = Layer.effect(
  CallerMiddleware,
  Effect.gen(function* () {
    const identifyOwner = yield* IdentifyOwner;
    const identifyHubKey = yield* IdentifyHubKey;

    const callerOf = Effect.fn("CallerMiddleware.callerOf")(function* (
      request: HttpServerRequest.HttpServerRequest,
    ) {
      for (const token of SignInCookie.tokensOf(request)) {
        const owner = yield* identifyOwner
          .execute(token)
          .pipe(Effect.catchTag("HubStoreUnavailable", hubStoreProblem));
        if (Option.isSome(owner)) {
          const { id, createdAt, expiresAt } = owner.value;
          const caller: Caller = {
            _tag: "Owner",
            signIn: { id, createdAt, expiresAt },
          };
          return Option.some(caller);
        }
      }
      const hubKey = yield* identifyHubKey.execute({
        cotaKey: request.headers["x-cota-key"],
        bearer: bearerOf(request.headers.authorization),
      });
      return Option.map(
        hubKey,
        (hubKey): Caller => ({ _tag: "HubKey", hubKey }),
      );
    });

    return CallerMiddleware.of((httpEffect, { endpoint }) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const mayCall = Context.get(endpoint.annotations, MayCall);
        const verdict = Access.decide({
          caller: yield* callerOf(request),
          mayCall,
          changes: request.method !== "GET" && request.method !== "HEAD",
          fetchSite: request.headers["sec-fetch-site"],
        });
        switch (verdict._tag) {
          case "SignInRequired":
            return yield* new SignInRequired({
              detail:
                "Sign in with POST /api/sign-in, or send a hub key in x-cota-key or as the bearer token.",
            });
          case "NotAllowed":
            return yield* new NotAllowed({
              detail: `A hub key of the ${verdict.scope} scope may not call ${request.method} ${endpoint.path}: ${whoMay[mayCall]} may.`,
            });
          case "CrossSite":
            return yield* new CrossSite({
              detail: `This browser sent ${request.method} ${endpoint.path} from another site (sec-fetch-site: ${request.headers["sec-fetch-site"]}).`,
            });
          case "Admitted":
            return yield* Effect.provideService(
              httpEffect,
              CurrentCaller,
              verdict.caller,
            );
        }
      }),
    );
  }),
);
