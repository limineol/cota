# A machine's day

I want to see what one machine did on one day: each session it ran, which client and pool it went through, how its requests split between the main conversation, subagents, titles and utility requests, how they ended, and how large its context grew.

The hub will answer `GET /api/machines/:machine/days/:day` with the answer below. It does not answer it yet, so add neither the endpoint nor a route: build the screen's view in `apps/web/src/screens/machine/`, taking the answer and the day from whoever renders it, with stories titled `Screens/Machine` fed by fixtures written from this answer. A busy day of eight sessions on three pools makes a good fixture, with a session that has no title, a few refusals and cancellations, and one error.

```ts
interface MachineDay {
  /** The machine tag, such as "ada-mbp.local". */
  readonly machine: string;
  /** The day, as an ISO date in the hub's time zone. */
  readonly day: string;
  /** Every pool of the configuration, in its order. */
  readonly pools: ReadonlyArray<string>;
  readonly sessions: ReadonlyArray<{
    readonly id: string;
    /** The title the client reported, or null. */
    readonly title: string | null;
    /** The first prompt, up to 200 characters, or null. */
    readonly firstPrompt: string | null;
    /** The client's id, such as "claude-code", "codex", "opencode". */
    readonly client: string;
    readonly pool: string;
    /** The project, such as "limineol/cota". */
    readonly project: string;
    readonly startedAt: string;
    readonly endedAt: string;
    readonly requests: ReadonlyArray<{
      readonly id: string;
      readonly at: string;
      readonly role: "main" | "subagent" | "title" | "utility";
      readonly outcome: "ok" | "error" | "refused" | "cancelled";
      /** Everything the request gave the model to read, in tokens, or null if its usage was not reported. */
      readonly promptSize: number | null;
      readonly outputTokens: number | null;
      readonly cost: number | null;
    }>;
  }>;
}
```

I want to move from one day to the one before or after, and to open a session's own page (`/sessions/$id`) from it.

Build it as the dashboard's other screens are built, and leave `bun run check` passing.
