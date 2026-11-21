import { Option, Schema } from "effect";
import { ModelId } from "#shared/03-domain/ids.ts";
import { charactersOf } from "#shared/03-domain/text.ts";
import type { Headers } from "./client-request.ts";

export const Session = Schema.Struct({
  id: Schema.String,
  source: Schema.String,
});
export type Session = typeof Session.Type;

export const Description = Schema.Struct({
  operation: Schema.String,
  model: Schema.Option(ModelId),
  session: Schema.Option(Session),
  stream: Schema.Boolean,
  purpose: Schema.String,
  serviceTier: Schema.String,
  headers: Schema.Record(Schema.String, Schema.String),
});
export type Description = typeof Description.Type;

const longestSession = 255;

/**
 * Gives the first of the named headers that holds a session id, trimmed, and
 * skips one that is empty or longer than 255 characters.
 */
export const sessionFrom = (
  headers: Headers,
  names: ReadonlyArray<string>,
): Option.Option<Session> => {
  for (const name of names) {
    const id = headers[name]?.trim() ?? "";
    if (id !== "" && charactersOf(id) <= longestSession) {
      return Option.some({ id, source: name });
    }
  }
  return Option.none();
};

export const keptHeaders = (
  headers: Headers,
  names: ReadonlyArray<string>,
): Record<string, string> => {
  const kept: Record<string, string> = {};
  for (const name of names) {
    const value = headers[name];
    if (value !== undefined) kept[name] = value;
  }
  return kept;
};
