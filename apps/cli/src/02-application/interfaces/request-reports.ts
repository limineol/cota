import { Context, type Effect, type Redacted, Schema } from "effect";
import type { HubAddress } from "#03-domain/hub-address.ts";
import type {
  HubFailed,
  HubKeyUnknown,
  HubUnreachable,
} from "#03-domain/machine.ts";

/** What the hub answered a report it stored: how many of its calls it stored, and how many it already held. */
export interface Stored {
  readonly stored: number;
  readonly held: number;
}

/** The hub answered a report with a problem: its status, its type and its detail, which never holds an item. */
export class ReportRefused extends Schema.TaggedError<
  ReportRefused,
  { readonly brand: unique symbol }
>()("ReportRefused", {
  status: Schema.Int,
  type: Schema.String,
  detail: Schema.String,
}) {}

/** Where the request reporter sends its reports. */
export class RequestReports extends Context.Service<
  RequestReports,
  {
    /**
     * Sends one report (`POST /api/reported-requests`), its body already
     * written out, with the hub key and `x-cota-machine`, waiting 120
     * seconds for the answer; `scratch` is a directory of `cota`'s where the
     * body may wait in a file while it is sent. `HubFailed` is an answer that
     * does not decode.
     */
    readonly send: (
      hub: HubAddress,
      key: Redacted.Redacted<string>,
      machine: string,
      body: string,
      scratch: string,
    ) => Effect.Effect<
      Stored,
      HubUnreachable | HubKeyUnknown | ReportRefused | HubFailed
    >;
  }
>()("@cota/cli/RequestReports") {}
