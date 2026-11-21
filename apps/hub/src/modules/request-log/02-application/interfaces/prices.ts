import { Context, type Option } from "effect";
import type * as Price from "#shared/03-domain/price.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";

export type Asked = Pick<
  Request.Request,
  "pool" | "protocol" | "model" | "servedModel" | "serviceTier"
>;

/** A request's price, from its pool's price list and its pool's own prices. */
export class Prices extends Context.Service<
  Prices,
  { readonly of: (asked: Asked) => Option.Option<Price.Price> }
>()("@cota/hub/request-log/Prices") {}
