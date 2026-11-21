import { Context, Effect, Layer, Redacted, Result, Schema } from "effect";
import { Environment } from "#02-application/interfaces/environment.ts";
import { Hub } from "#02-application/interfaces/hub.ts";
import { Terminal } from "#02-application/interfaces/terminal.ts";
import type { HubAddress } from "#03-domain/hub-address.ts";
import { HubUnreachable, hubDeadline } from "#03-domain/machine.ts";

/** What a command run as the owner could not do, one sentence each; none holds the password. */
export class OwnerCommandFailed extends Schema.TaggedError<
  OwnerCommandFailed,
  { readonly brand: unique symbol }
>()("OwnerCommandFailed", { problems: Schema.Array(Schema.String) }) {}

export class AsOwner extends Context.Service<
  AsOwner,
  {
    /**
     * Signs in to the hub as the owner, with `COTA_OWNER_PASSWORD` or a
     * prompt that does not echo, runs what is given with the sign-in, and
     * signs out before it ends, whether it succeeded, failed or was
     * interrupted (`docs/specs/cli/spec.md`, Routes from the CLI).
     */
    readonly execute: <A, E>(
      hub: HubAddress,
      use: (signIn: Redacted.Redacted<string>) => Effect.Effect<A, E>,
    ) => Effect.Effect<A, E | OwnerCommandFailed>;
  }
>()("@cota/cli/AsOwner") {}

const passwordVariable = "COTA_OWNER_PASSWORD";

export const layer: Layer.Layer<AsOwner, never, Environment | Hub | Terminal> =
  Layer.effect(
    AsOwner,
    Effect.gen(function* () {
      const { variables } = yield* Environment;
      const hub = yield* Hub;
      const terminal = yield* Terminal;

      const stop = (problem: string) =>
        Effect.fail(new OwnerCommandFailed({ problems: [problem] }));

      const password = Effect.gen(function* () {
        const given = variables[passwordVariable];
        if (given !== undefined && given !== "") return given;
        if (!terminal.interactive) {
          return yield* stop(
            `${passwordVariable} is not set, and standard input is not a terminal to ask for the owner password on`,
          );
        }
        return yield* terminal.secret("Owner password: ");
      });

      const signIn = Effect.fn(function* (address: HubAddress) {
        const typed = yield* password;
        if (typed === "") return yield* stop("no owner password was given");
        const signedIn = yield* Effect.result(
          hub.signIn(address, Redacted.make(typed)).pipe(
            Effect.timeoutOrElse({
              duration: hubDeadline,
              orElse: () => Effect.fail(new HubUnreachable()),
            }),
          ),
        );
        if (Result.isSuccess(signedIn)) return signedIn.success;
        const error = signedIn.failure;
        switch (error._tag) {
          case "HubUnreachable":
            return yield* stop(`${address} cannot be reached`);
          case "HubFailed":
            return yield* stop(`${address} could not sign the owner in`);
          case "SignInRefused":
            switch (error.refusal) {
              case "wrong-password":
                return yield* stop("the owner password is wrong");
              case "password-off":
                return yield* stop(
                  `${address} signs the owner in only with a passkey; change the routes in Settings → Routes`,
                );
              case "not-set-up":
                return yield* stop(
                  `${address} is not set up: open its dashboard and set it up first`,
                );
              case "too-many-attempts":
                return yield* stop(
                  `${address} takes no password for now, after too many wrong ones; try again in ${error.retryAfter ?? "a few"} seconds`,
                );
            }
        }
      });

      return AsOwner.of({
        execute: <A, E>(
          address: HubAddress,
          use: (signIn: Redacted.Redacted<string>) => Effect.Effect<A, E>,
        ) =>
          Effect.acquireUseRelease(signIn(address), use, (signedIn) =>
            hub.signOut(address, signedIn).pipe(
              Effect.timeoutOrElse({
                duration: hubDeadline,
                orElse: () => Effect.fail(new HubUnreachable()),
              }),
              Effect.catch(() =>
                terminal.printError(
                  `cota: signing out of ${address} failed; the sign-in lasts until it expires or is revoked in Settings.\n`,
                ),
              ),
            ),
          ),
      });
    }),
  );
