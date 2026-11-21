# A model's price for a pool

A pool can give its own price for a model, which wins over the price list the hub ships. Today that is only in the configuration file; I want to set it from the dashboard.

The hub will answer `GET /api/pools/:pool/prices/:model` with the answer below, take `PUT` of the same path with the four prices, and take `DELETE` to drop the pool's own price. It does not answer them yet, so add neither the endpoints nor a route: build the form in `apps/web/src/screens/price/`, taking what the hub answered and a way to save or drop from whoever renders it, with stories titled `Screens/Price` fed by fixtures written from these answers.

```ts
/** Dollars per million tokens, by usage class. */
interface Prices {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

interface ModelPrice {
  readonly pool: string;
  readonly model: string;
  /** The shipped price list's price, or null when the list does not know the model. */
  readonly listed: Prices | null;
  /** The pool's own price, or null when it has none. */
  readonly own: Prices | null;
  /** Requests of the last 7 days to this model through this pool that have no cost because neither price exists. */
  readonly unpricedRequests: number;
}
```

`PUT` answers 200 with the `ModelPrice` as kept, or one of these problems (`application/problem+json`, with `type`, `title`, `status` and a `detail`):

- 400 `urn:cota:invalid-price`, "A price must be a number of dollars, zero or more.", whose detail names the field;
- 404 `urn:cota:no-such-pool`, "The hub has no such pool.";
- 503 `urn:cota:hub-store-unavailable`, "The hub store did not answer.".

The form shows each of the four prices beside the listed one, says which price is in force, saves the pool's own price, drops it, and says what happened. Show it while it reads, for a model the list knows and one it does not, with and without a price of the pool's own, while it saves, saved, refused, and when the hub cannot be reached.

Build it as the dashboard's other screens are built, and leave `bun run check` passing.
