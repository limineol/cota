import { Context } from "effect";

/** The owner password the configuration gives, if it gives one; while it does, it alone signs in (ADR-0021). */
export class ConfiguredPassword extends Context.Service<
  ConfiguredPassword,
  {
    readonly isSet: boolean;
    /**
     * Whether a password given is the configuration's, compared in a time
     * that does not tell how much of it matched; never, without one.
     */
    readonly matches: (given: string) => boolean;
  }
>()("@cota/hub/sign-in/ConfiguredPassword") {}
