import { Context, type Option } from "effect";
import type { StoredProtocol } from "#modules/request-log/03-domain/stored-protocol.ts";
import type * as Price from "#shared/03-domain/price.ts";
import type * as Request from "#shared/03-domain/request.entity.ts";

/** What prices a request: its pool and model, and of a forwarded request what it was sent and served as; a reported request's protocol is its record form. */
export type Asked = Pick<Request.Request, "pool" | "model"> &
  Pick<Request.Forwarded, "servedModel" | "serviceTier"> & {
    readonly protocol: StoredProtocol;
  };

/** A request's price, from its pool's price list and its pool's own prices. */
export class Prices extends Context.Service<
  Prices,
  { readonly of: (asked: Asked) => Option.Option<Price.Price> }
>()("@cota/hub/request-log/Prices") {}
