import { Schema } from "effect";

/** A hub store call that failed while the hub runs; the API answers it 503 `urn:cota:hub-store-unavailable`. */
export class HubStoreUnavailable extends Schema.TaggedError<
  HubStoreUnavailable,
  { readonly brand: unique symbol }
>()("HubStoreUnavailable", { detail: Schema.String }) {
  override get message(): string {
    return this.detail;
  }
}
