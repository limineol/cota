import { Context, type Effect, type Redacted } from "effect";
import type { HubAddress } from "#03-domain/hub-address.ts";
import type {
  HubFailed,
  HubKeyUnknown,
  HubUnreachable,
} from "#03-domain/machine.ts";

/** Where the title reporter sends its batches. */
export class TitleReports extends Context.Service<
  TitleReports,
  {
    /**
     * Sends one batch of titles (`PUT /api/session-titles`) with the hub key
     * and `x-cota-machine`, and succeeds only when the hub answers 204.
     * `HubFailed` is any other answer.
     */
    readonly send: (
      hub: HubAddress,
      key: Redacted.Redacted<string>,
      machine: string,
      titles: ReadonlyMap<string, string>,
    ) => Effect.Effect<void, HubUnreachable | HubKeyUnknown | HubFailed>;
  }
>()("@cota/cli/TitleReports") {}
