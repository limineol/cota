import { Effect, Layer } from "effect";
import { Terminal } from "#02-application/interfaces/terminal.ts";

export interface Script {
  /** Standard input, when it is not a terminal. */
  readonly input?: string;
  /** The lines a person types at the prompts, when standard input is a terminal. */
  readonly typed?: ReadonlyArray<string>;
}

/** What `cota` printed, and asked. */
export interface Printed {
  readonly out: Array<string>;
  readonly err: Array<string>;
  readonly questions: Array<string>;
}

export const make = (
  script: Script = {},
): { readonly printed: Printed; readonly layer: Layer.Layer<Terminal> } => {
  const printed: Printed = { out: [], err: [], questions: [] };
  const typed = [...(script.typed ?? [])];
  const layer = Layer.succeed(
    Terminal,
    Terminal.of({
      interactive: script.typed !== undefined,
      input: Effect.succeed(script.input ?? ""),
      secret: (question) =>
        Effect.sync(() => {
          printed.questions.push(question);
          return typed.shift() ?? "";
        }),
      print: (text) => Effect.sync(() => void printed.out.push(text)),
      printError: (text) => Effect.sync(() => void printed.err.push(text)),
    }),
  );
  return { printed, layer };
};
