import { Context, type Effect } from "effect";

/** Standard input, output and error, and the person at the terminal when there is one. */
export class Terminal extends Context.Service<
  Terminal,
  {
    /** Whether standard input is a terminal a person types at. */
    readonly interactive: boolean;
    /** The whole of standard input. */
    readonly input: Effect.Effect<string>;
    /** Asks on the terminal, and reads one line without echoing it. */
    readonly secret: (question: string) => Effect.Effect<string>;
    readonly print: (text: string) => Effect.Effect<void>;
    readonly printError: (text: string) => Effect.Effect<void>;
  }
>()("@cota/cli/Terminal") {}
