# The hub keys

I want a screen in the dashboard that lists the hub's hub keys, so I can see which machines still use which key and retire the ones nobody uses any more.

The hub will answer `GET /api/keys` with the answer below. It does not answer it yet, so add neither the endpoint nor a route: build the screen's view in `apps/web/src/screens/keys/`, taking the answer from whoever renders it, with stories titled `Screens/Keys` fed by fixtures written from this answer. A dozen keys of the three scopes make a good fixture, a few of them never used.

```ts
interface Keys {
  readonly keys: ReadonlyArray<{
    /** The key's id in the configuration, such as "k_7f3a9c". Never the secret. */
    readonly id: string;
    /** The note the owner wrote beside it in the configuration, such as "work laptop", or null. */
    readonly note: string | null;
    readonly scope: "subscription" | "keyed" | "reader";
    /** The ids of the pools it opens, in the configuration's order; none for a reader key. */
    readonly pools: ReadonlyArray<string>;
    /** When it last sent a request, as an ISO time, or null if it never has. */
    readonly lastUsedAt: string | null;
    /** The machine its last request was tagged with, or null if it never sent one. */
    readonly lastMachine: string | null;
    /** Its requests in the last 7 days. */
    readonly requests: number;
    /** The tokens of those requests, or null when none of them reported its usage. */
    readonly tokens: number | null;
  }>;
  /** Every pool of the configuration, in its order. */
  readonly pools: ReadonlyArray<string>;
  /** The first day the request log holds, as an ISO date: the 7 days may begin before it. */
  readonly logBegins: string;
}
```

For each key I want to see what it opens, when it was last used and from which machine, and how much it carried in the last 7 days. I want to narrow the list to one scope, and to sort it by last use or by requests.

Build it as the dashboard's other screens are built, and leave `bun run check` passing.
