import type { DateTime, Effect, Option } from "effect";
import type { Headers } from "./client-request.ts";

export interface Refusal {
  readonly reset: Option.Option<DateTime.Utc>;
}

export interface Head {
  readonly status: number;
  readonly headers: Headers;
}

export interface Answer extends Head {
  readonly body: string;
}

/**
 * How a protocol tells a refusal: from the answer's status and headers, which
 * the hub has before the first byte reaches the client, or from the start of
 * its body, which it has only once the body has passed.
 */
export type RefusalRule =
  | {
      readonly _tag: "FromHead";
      readonly of: (head: Head) => Effect.Effect<Option.Option<Refusal>>;
    }
  | {
      readonly _tag: "FromBody";
      readonly of: (answer: Answer) => Effect.Effect<Option.Option<Refusal>>;
    };
