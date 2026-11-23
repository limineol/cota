import { Option, type Schema } from "effect";
import * as AntigravitySteps from "#modules/request-log/03-domain/antigravity-steps.ts";
import * as Transcript from "#modules/request-log/03-domain/transcript.ts";

const entriesOf = (
  said: AntigravitySteps.Said,
): ReadonlyArray<Transcript.ItemEntry> => {
  switch (said.kind) {
    case "user":
      return [Transcript.message("user", [Transcript.text(said.text)])];
    case "model": {
      const nonEmpty = (text: Option.Option<string>) =>
        Option.filter(text, (each) => each !== "");
      const entries = [
        ...Option.toArray(
          Option.map(nonEmpty(said.thoughts), (thoughts) =>
            Transcript.reasoning(Option.some(thoughts)),
          ),
        ),
        ...Option.toArray(
          Option.map(nonEmpty(said.text), (text) =>
            Transcript.message("assistant", [Transcript.text(text)]),
          ),
        ),
        ...said.calls.map((call) =>
          Transcript.toolCall(call.id, call.name, call.arguments),
        ),
      ];
      return entries.length > 0
        ? entries
        : [Transcript.message("assistant", [])];
    }
    case "result":
      return [
        Transcript.toolResult(
          Option.flatMap(said.call, (call) => call.id),
          said.text,
          false,
        ),
      ];
    case "compaction":
      return [Transcript.message("assistant", [Transcript.text(said.summary)])];
  }
};

/** How the steps of an Antigravity record read, by the record form's table (`docs/specs/reported-requests/spec.md`, The record form). */
export const renderer: Transcript.Renderer = {
  said: (item: Schema.Json) =>
    Option.match(
      Option.flatMap(AntigravitySteps.stepOf(item), AntigravitySteps.saidOf),
      {
        onNone: () => [Transcript.other(item)],
        onSome: entriesOf,
      },
    ),
  tool: () => ({ name: Option.none(), description: Option.none() }),
};
