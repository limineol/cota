import { Effect, Option } from "effect";
import {
  HttpEffect,
  type HttpServerRequest,
  HttpServerResponse,
} from "effect/http";
import type { HttpApiBuilder } from "effect/http-api";
import { ChangeOwnerPassword } from "#modules/sign-in/02-application/commands/change-owner-password.command.ts";
import { ForgetOwnerPassword } from "#modules/sign-in/02-application/commands/forget-owner-password.command.ts";
import { MakePasskey } from "#modules/sign-in/02-application/commands/make-passkey.command.ts";
import { PreparePasskey } from "#modules/sign-in/02-application/commands/prepare-passkey.command.ts";
import { PreparePasskeySignIn } from "#modules/sign-in/02-application/commands/prepare-passkey-sign-in.command.ts";
import { RemovePasskey } from "#modules/sign-in/02-application/commands/remove-passkey.command.ts";
import { RevokeOtherSignIns } from "#modules/sign-in/02-application/commands/revoke-other-sign-ins.command.ts";
import { RevokeSignIn } from "#modules/sign-in/02-application/commands/revoke-sign-in.command.ts";
import { SetUpHub } from "#modules/sign-in/02-application/commands/set-up-hub.command.ts";
import { SignInOwner } from "#modules/sign-in/02-application/commands/sign-in-owner.command.ts";
import { SignInWithPasskey } from "#modules/sign-in/02-application/commands/sign-in-with-passkey.command.ts";
import { ListPasskeys } from "#modules/sign-in/02-application/queries/list-passkeys.query.ts";
import { ListSignIns } from "#modules/sign-in/02-application/queries/list-sign-ins.query.ts";
import { ReadOwnerPassword } from "#modules/sign-in/02-application/queries/read-owner-password.query.ts";
import { ReadWaysIn } from "#modules/sign-in/02-application/queries/read-ways-in.query.ts";
import * as Access from "#modules/sign-in/03-domain/access.ts";
import type * as Attempts from "#modules/sign-in/03-domain/attempts.ts";
import type { Passkey } from "#modules/sign-in/03-domain/passkey.ts";
import type { NotAPasskeyOrigin } from "#modules/sign-in/03-domain/relying-party.ts";
import { CurrentCaller } from "#shared/01-presentation/caller.middleware.ts";
import {
  CrossSite,
  hubStoreProblem,
  NotAllowed,
} from "#shared/01-presentation/problems.ts";
import * as SignInApi from "./sign-in.api.ts";
import * as SignInCookie from "./sign-in-cookie.ts";

/** The sign-in that admitted the request, which an endpoint only the owner may call always has. */
const currentSignIn = Effect.gen(function* () {
  const caller = yield* CurrentCaller;
  if (caller._tag === "Owner") return caller.signIn;
  return yield* new NotAllowed({ detail: "Only the owner, signed in, may." });
});

/** A passkey as the API lists it: never its key. */
const listed = (passkey: Passkey) => ({
  id: passkey.id,
  userAgent: passkey.userAgent,
  origin: passkey.relyingParty.origin,
  createdAt: passkey.createdAt,
  lastUsedAt: Option.getOrNull(passkey.lastUsedAt),
});

const whereBrowsersOfferPasskeys =
  "A browser offers a passkey only to a page served over https at a host name, or on localhost.";

/** The 400 of a request whose `Origin` no browser offers a passkey at. */
const notAPasskeyOrigin = ({ origin }: NotAPasskeyOrigin) =>
  Effect.fail(
    new SignInApi.NotAPasskeyOrigin({
      detail: `${origin === undefined ? "This request has no Origin." : `This request's Origin is ${JSON.stringify(origin)}.`} ${whereBrowsersOfferPasskeys}`,
    }),
  );

/** Refuses a request that needs no caller when a browser sent it from another site (I9). */
const refusedFromAnotherSite = (
  request: HttpServerRequest.HttpServerRequest,
  path: string,
) =>
  Effect.gen(function* () {
    const fetchSite = request.headers["sec-fetch-site"];
    if (Access.fromAnotherSite(fetchSite)) {
      return yield* new CrossSite({
        detail: `This browser sent POST ${path} from another site (sec-fetch-site: ${fetchSite}).`,
      });
    }
  });

/** The 429 of the attempt limit, with `retry-after`. */
const tooManyAttempts = ({ retryAfterSeconds }: Attempts.TooManyAttempts) =>
  HttpEffect.appendPreResponseHandler((_request, response) =>
    Effect.succeed(
      HttpServerResponse.setHeader(
        response,
        "retry-after",
        String(retryAfterSeconds),
      ),
    ),
  ).pipe(
    Effect.andThen(
      Effect.fail(
        new SignInApi.TooManyAttempts({
          detail: `Try again in ${retryAfterSeconds} seconds.`,
        }),
      ),
    ),
  );

export const build = (
  handlers: HttpApiBuilder.Handlers.FromGroup<typeof SignInApi.group>,
) =>
  Effect.gen(function* () {
    const signInOwner = yield* SignInOwner;
    const setUpHub = yield* SetUpHub;
    const changeOwnerPassword = yield* ChangeOwnerPassword;
    const revokeSignIn = yield* RevokeSignIn;
    const revokeOtherSignIns = yield* RevokeOtherSignIns;
    const listSignIns = yield* ListSignIns;
    const readWaysIn = yield* ReadWaysIn;
    const readOwnerPassword = yield* ReadOwnerPassword;
    const forgetOwnerPassword = yield* ForgetOwnerPassword;
    const preparePasskey = yield* PreparePasskey;
    const makePasskey = yield* MakePasskey;
    const listPasskeys = yield* ListPasskeys;
    const removePasskey = yield* RemovePasskey;
    const preparePasskeySignIn = yield* PreparePasskeySignIn;
    const signInWithPasskey = yield* SignInWithPasskey;

    return handlers
      .handle("signIn", ({ payload, request }) =>
        Effect.gen(function* () {
          yield* refusedFromAnotherSite(request, "/api/sign-in");
          const { token } = yield* signInOwner
            .execute({
              password: payload.password,
              userAgent: request.headers["user-agent"] ?? "",
            })
            .pipe(
              Effect.catchTags({
                HubStoreUnavailable: hubStoreProblem,
                NotSetUp: () =>
                  Effect.fail(
                    new SignInApi.NotSetUp({
                      detail:
                        "Give POST /api/setup the setup code this hub printed in its log at start, with the owner password you choose; or set [sign_in] password in its configuration and restart it.",
                    }),
                  ),
                PasswordOff: () =>
                  Effect.fail(
                    new SignInApi.PasswordOff({
                      detail:
                        "Sign in with a passkey; or set [sign_in] password in the hub's configuration and restart it.",
                    }),
                  ),
                WrongPassword: () =>
                  Effect.fail(
                    new SignInApi.WrongPassword({
                      detail:
                        "Check it and try again: 10 wrong passwords in 10 minutes pause signing in.",
                    }),
                  ),
                TooManyAttempts: tooManyAttempts,
              }),
            );
          return SignInCookie.given(request, token);
        }),
      )
      .handle("waysIn", () =>
        readWaysIn.execute.pipe(
          Effect.catchTag("HubStoreUnavailable", hubStoreProblem),
        ),
      )
      .handle("setUp", ({ payload, request }) =>
        Effect.gen(function* () {
          yield* refusedFromAnotherSite(request, "/api/setup");
          const { token } = yield* setUpHub
            .execute({
              code: payload.code,
              password: payload.password,
              userAgent: request.headers["user-agent"] ?? "",
            })
            .pipe(
              Effect.catchTags({
                HubStoreUnavailable: hubStoreProblem,
                AlreadySetUp: () =>
                  Effect.fail(
                    new SignInApi.AlreadySetUp({
                      detail:
                        "Its owner signs in with POST /api/sign-in; the setup code opens nothing now.",
                    }),
                  ),
                WrongSetupCode: () =>
                  Effect.fail(
                    new SignInApi.WrongSetupCode({
                      detail:
                        "Give the code this hub printed in its log at its latest start; case, hyphens and spaces do not matter.",
                    }),
                  ),
                TooManyAttempts: tooManyAttempts,
              }),
            );
          return SignInCookie.given(request, token);
        }),
      )
      .handle("ownerPassword", () =>
        Effect.gen(function* () {
          const { source, setAt } = yield* readOwnerPassword.execute.pipe(
            Effect.catchTag("HubStoreUnavailable", hubStoreProblem),
          );
          return { source, setAt: Option.getOrNull(setAt) };
        }),
      )
      .handle("changeOwnerPassword", ({ payload }) =>
        Effect.gen(function* () {
          const signIn = yield* currentSignIn;
          yield* changeOwnerPassword
            .execute({
              signIn: signIn.id,
              current: Option.fromUndefinedOr(payload.current),
              password: payload.password,
            })
            .pipe(
              Effect.catchTags({
                HubStoreUnavailable: hubStoreProblem,
                PasswordInConfiguration: () =>
                  Effect.fail(
                    new SignInApi.PasswordInConfiguration({
                      detail:
                        "Change [sign_in] password in the hub's configuration, and restart the hub.",
                    }),
                  ),
                WrongPassword: () =>
                  Effect.fail(
                    new SignInApi.WrongPassword({
                      detail:
                        "The current password given is not the owner password.",
                    }),
                  ),
                TooManyAttempts: tooManyAttempts,
              }),
            );
        }),
      )
      .handle("forgetOwnerPassword", () =>
        forgetOwnerPassword.execute.pipe(
          Effect.catchTags({
            HubStoreUnavailable: hubStoreProblem,
            LastWayIn: () =>
              Effect.fail(
                new SignInApi.LastWayIn({
                  detail:
                    "Make a passkey first, or set [sign_in] password in the hub's configuration: the owner signs in with the stored password alone.",
                }),
              ),
          }),
        ),
      )
      .handle("preparePasskey", ({ request }) =>
        preparePasskey.execute(request.headers.origin).pipe(
          Effect.catchTags({
            HubStoreUnavailable: hubStoreProblem,
            NotAPasskeyOrigin: notAPasskeyOrigin,
          }),
        ),
      )
      .handle("makePasskey", ({ payload, request }) =>
        Effect.gen(function* () {
          const made = yield* makePasskey
            .execute({
              response: payload,
              userAgent: request.headers["user-agent"] ?? "",
            })
            .pipe(
              Effect.catchTags({
                HubStoreUnavailable: hubStoreProblem,
                PasskeyNotMade: () =>
                  Effect.fail(
                    new SignInApi.PasskeyNotMade({
                      detail:
                        "Answer the options of POST /api/passkeys/options at the origin that asked for them, with the user verified, within 5 minutes and once.",
                    }),
                  ),
                PasskeyExists: () =>
                  Effect.fail(
                    new SignInApi.PasskeyExists({
                      detail:
                        "The browser answered with a passkey this hub keeps already.",
                    }),
                  ),
              }),
            );
          return listed(made);
        }),
      )
      .handle("passkeys", () =>
        Effect.gen(function* () {
          const kept = yield* listPasskeys.execute.pipe(
            Effect.catchTag("HubStoreUnavailable", hubStoreProblem),
          );
          return { passkeys: kept.map(listed) };
        }),
      )
      .handle("removePasskey", ({ params }) =>
        removePasskey.execute(params.id).pipe(
          Effect.catchTags({
            HubStoreUnavailable: hubStoreProblem,
            NoSuchPasskey: ({ id }) =>
              Effect.fail(
                new SignInApi.NoSuchPasskey({
                  detail: `The hub keeps no passkey "${id}".`,
                }),
              ),
            LastWayIn: () =>
              Effect.fail(
                new SignInApi.LastWayIn({
                  detail:
                    "It is the last passkey and the hub has no owner password: set a password, or make another passkey, first.",
                }),
              ),
          }),
        ),
      )
      .handle("preparePasskeySignIn", ({ request }) =>
        Effect.gen(function* () {
          yield* refusedFromAnotherSite(
            request,
            "/api/sign-in/passkey/options",
          );
          return yield* preparePasskeySignIn
            .execute(request.headers.origin)
            .pipe(
              Effect.catchTags({
                HubStoreUnavailable: hubStoreProblem,
                NotAPasskeyOrigin: notAPasskeyOrigin,
                NoPasskeys: () =>
                  Effect.fail(
                    new SignInApi.NoPasskeys({
                      detail:
                        "Sign in with the owner password; a signed-in owner makes a passkey with POST /api/passkeys/options and POST /api/passkeys.",
                    }),
                  ),
              }),
            );
        }),
      )
      .handle("signInWithPasskey", ({ payload, request }) =>
        Effect.gen(function* () {
          yield* refusedFromAnotherSite(request, "/api/sign-in/passkey");
          const { token } = yield* signInWithPasskey
            .execute({
              response: payload,
              userAgent: request.headers["user-agent"] ?? "",
            })
            .pipe(
              Effect.catchTags({
                HubStoreUnavailable: hubStoreProblem,
                PasskeyRefused: () =>
                  Effect.fail(
                    new SignInApi.PasskeyRefused({
                      detail:
                        "Ask POST /api/sign-in/passkey/options again, and answer it once, within 5 minutes, with a passkey this hub keeps, made at this address.",
                    }),
                  ),
              }),
            );
          return SignInCookie.given(request, token);
        }),
      )
      .handle("signOut", ({ request }) =>
        Effect.gen(function* () {
          const signIn = yield* currentSignIn;
          yield* revokeSignIn.execute(signIn.id).pipe(
            Effect.catchTags({
              HubStoreUnavailable: hubStoreProblem,
              NoSuchSignIn: () => Effect.void,
            }),
          );
          return SignInCookie.cleared(request);
        }),
      )
      .handle("me", () =>
        Effect.gen(function* () {
          const caller = yield* CurrentCaller;
          return caller._tag === "Owner"
            ? { caller: "owner" as const, hubKey: null, signIn: caller.signIn }
            : {
                caller: "hub-key" as const,
                hubKey: caller.hubKey,
                signIn: null,
              };
        }),
      )
      .handle("signIns", () =>
        Effect.gen(function* () {
          const current = yield* currentSignIn;
          const live = yield* listSignIns.execute.pipe(
            Effect.catchTag("HubStoreUnavailable", hubStoreProblem),
          );
          return {
            signIns: live.map((signIn) => ({
              id: signIn.id,
              createdAt: signIn.createdAt,
              expiresAt: signIn.expiresAt,
              lastUsedAt: signIn.lastUsedAt,
              userAgent: signIn.userAgent,
              current: signIn.id === current.id,
            })),
          };
        }),
      )
      .handle("revokeSignIn", ({ params }) =>
        revokeSignIn.execute(params.id).pipe(
          Effect.catchTags({
            HubStoreUnavailable: hubStoreProblem,
            NoSuchSignIn: ({ id }) =>
              Effect.fail(
                new SignInApi.NoSuchSignIn({
                  detail: `The hub has no live sign-in "${id}".`,
                }),
              ),
          }),
        ),
      )
      .handle("revokeOtherSignIns", () =>
        Effect.gen(function* () {
          const current = yield* currentSignIn;
          const revoked = yield* revokeOtherSignIns
            .execute(current.id)
            .pipe(Effect.catchTag("HubStoreUnavailable", hubStoreProblem));
          return { revoked };
        }),
      );
  });
