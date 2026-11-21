import {
  Context,
  type Effect,
  type Option,
  Schema,
  type Scope,
  type Stream,
} from "effect";
import type * as Protocol from "#modules/relay/02-application/interfaces/protocol.ts";
import type * as Credential from "#modules/relay/03-domain/credential.ts";
import type * as FinishedRequest from "#modules/relay/03-domain/finished-request.ts";
import type { Method } from "#modules/relay/03-domain/method.ts";
import type { RequestId } from "#shared/03-domain/request.entity.ts";

/** Where a request goes, how, with which credential, and its body as it arrived. */
export interface Outgoing {
  readonly method: Method;
  readonly url: string;
  readonly credential: Credential.Credential;
  readonly body: Uint8Array;
}

// The server prints a response stream's failure; the client's error would
// print the request it was for.
export class ProviderStreamBroken extends Schema.TaggedError<
  ProviderStreamBroken,
  { readonly brand: unique symbol }
>()("ProviderStreamBroken", {}) {
  override get message() {
    return "The provider broke the stream.";
  }
}

export interface NoAnswer {
  readonly type: "cota_provider_unreachable" | "cota_provider_timeout";
  readonly message: string;
}

export type Answer =
  | {
      readonly _tag: "Unanswered";
      readonly request: RequestId;
      readonly reason: NoAnswer;
    }
  | {
      readonly _tag: "Answered";
      readonly status: number;
      readonly headers: Readonly<Record<string, string>>;
      readonly setCookies: ReadonlyArray<string>;
      readonly body: Option.Option<
        Stream.Stream<Uint8Array, ProviderStreamBroken>
      >;
    };

export interface Diverted {
  readonly _tag: "Diverted";
  readonly plan: Credential.Plan;
}

/** A pool's provider, which the hub sends a request to once and brings its answer back from. */
export class Provider extends Context.Service<
  Provider,
  {
    /**
     * Sends a request and passes its answer on as it arrives, giving the
     * request to the request log once it is finished; a refusal known before
     * the answer reaches the client is reported to `onRefusal`, and when that
     * diverts, the refused answer is dropped.
     */
    readonly exchange: (
      start: FinishedRequest.Start,
      protocol: Protocol.Protocol,
      outgoing: Outgoing,
      onRefusal: Option.Option<Credential.OnRefusal>,
    ) => Effect.Effect<Answer | Diverted, never, Scope.Scope>;
  }
>()("@cota/hub/relay/Provider") {}
