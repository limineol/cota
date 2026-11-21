# A pool's page

I want a page for one pool: how its quota windows stand, what it carried over a range of days against the range before, which models its requests went to, and the largest context its requests reached.

The hub will answer `GET /api/pools/:pool/summary?range=7d` (the range is `1d`, `7d` or `30d`) with the answer below. It does not answer it yet, so add neither the endpoint nor a route: build the page's view in `apps/web/src/screens/pool/`, taking the answer from whoever renders it, with stories titled `Screens/Pool` fed by fixtures written from this answer. Give it a Claude subscription with two windows and five models, a pool whose windows the hub has not read, and a pool with requests whose model has no price.

```ts
interface PoolSummary {
  readonly pool: {
    readonly id: string;
    readonly kind: "subscription" | "keyed";
    /** The provider's id, such as "anthropic", "chatgpt", "zai", "opencode-go". */
    readonly provider: string;
    readonly plan: string | null;
  };
  /** Every pool of the configuration, in its order. */
  readonly pools: ReadonlyArray<string>;
  /** As `GET /api/pools` gives them. */
  readonly windows: ReadonlyArray<{
    readonly lengthMs: number;
    /** null for the whole plan, else what the window covers, such as "Opus". */
    readonly scope: string | null;
    readonly usedPercent: number;
    readonly startsAt: string | null;
    readonly resetsAt: string | null;
    readonly standing: {
      /** The share of the window gone, 0 to 1. */
      readonly elapsed: number;
      readonly resetsInMs: number;
      readonly pace: "full" | "on-pace" | "in-reserve" | "ahead-of-pace";
      /** How far under or over pace, in percentage points. */
      readonly points: number | null;
      readonly emptiesInMs: number | null;
    } | null;
  }>;
  readonly range: "1d" | "7d" | "30d";
  /** The first day the request log holds, as an ISO date: the range may begin before it. */
  readonly logBegins: string;
  readonly totals: {
    readonly requests: number;
    readonly tokens: number;
    /** In dollars, of the requests whose model has a price. */
    readonly cost: number;
    readonly unpricedRequests: number;
    /** The same figures over the range before, or null where the log does not cover it. */
    readonly previous: { readonly requests: number; readonly tokens: number; readonly cost: number } | null;
  };
  readonly models: ReadonlyArray<{
    readonly model: string;
    readonly requests: number;
    readonly tokens: number;
    readonly cost: number | null;
  }>;
  /** One per day of the range. promptSize is the largest prompt size of the day's requests, or null if none reported it. */
  readonly days: ReadonlyArray<{
    readonly day: string;
    readonly requests: number;
    readonly tokens: number;
    readonly promptSize: number | null;
  }>;
}
```

Build it as the dashboard's other screens are built, and leave `bun run check` passing.
