import { Context, type DateTime, type Effect, type Option } from "effect";
import type {
  QuotaLogin,
  RefreshRefused,
  Secret,
} from "#modules/quota/03-domain/quota-login.ts";
import type { ReadFailure } from "#modules/quota/03-domain/readings.ts";

/** What a good refresh gave: a new access token, the refresh token when it rotated it, and when the new access token ends. */
export interface Refreshed {
  readonly accessToken: Secret;
  readonly refreshToken: Option.Option<Secret>;
  readonly endsAt: DateTime.Utc;
}

/** Asks a quota login's provider for a new access token with its refresh token, as the provider's own client does. */
export class TokenEndpoints extends Context.Service<
  TokenEndpoints,
  {
    /**
     * One call of the provider's token endpoint; a refusal of the refresh
     * token is `RefreshRefused`, any other failure a `ReadFailure` naming the
     * token endpoint.
     */
    readonly refresh: (
      login: QuotaLogin,
    ) => Effect.Effect<Refreshed, ReadFailure | RefreshRefused>;
  }
>()("@cota/hub/quota/TokenEndpoints") {}
