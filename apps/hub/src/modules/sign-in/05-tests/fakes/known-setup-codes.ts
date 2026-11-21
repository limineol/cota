import { Effect, Layer } from "effect";
import { SetupCodes } from "#modules/sign-in/02-application/interfaces/setup-codes.ts";
import * as SetupCode from "#modules/sign-in/03-domain/setup-code.ts";
import {
  digestOf,
  matches,
} from "#modules/sign-in/04-infrastructure/random-setup-codes.ts";

/** The setup code every hub of the laws makes, so they can give it. */
export const code = "K7QM-2F0X-HD1P";

/** `SetupCodes` that always makes `code`, and reads a code as the real ones do. */
export const layer: Layer.Layer<SetupCodes> = Layer.succeed(
  SetupCodes,
  SetupCodes.of({
    make: Effect.succeed({
      written: code,
      digest: digestOf(SetupCode.normalised(code)),
    }),
    matches,
  }),
);
