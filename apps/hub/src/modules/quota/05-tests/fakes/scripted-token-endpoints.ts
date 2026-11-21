import { Effect, Layer } from "effect";
import { TokenEndpoints } from "#modules/quota/02-application/interfaces/token-endpoints.ts";

/** Token endpoints that answer every refresh with `refresh`; by default, a refresh dies. */
export const layer = (
  refresh: TokenEndpoints["Service"]["refresh"] = () =>
    Effect.die("the scripted token endpoints were not asked to refresh"),
): Layer.Layer<TokenEndpoints> =>
  Layer.succeed(TokenEndpoints, TokenEndpoints.of({ refresh }));
