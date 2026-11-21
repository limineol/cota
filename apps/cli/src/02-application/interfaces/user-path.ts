import { Context, type Effect, Schema } from "effect";

export class UserPathFailed extends Schema.TaggedError<
  UserPathFailed,
  { readonly brand: unique symbol }
>()("UserPathFailed", { reason: Schema.String }) {}

/** The user's `Path` variable on Windows, which new terminals read. */
export class UserPath extends Context.Service<
  UserPath,
  {
    readonly read: Effect.Effect<string, UserPathFailed>;
    readonly write: (path: string) => Effect.Effect<void, UserPathFailed>;
  }
>()("@cota/cli/UserPath") {}
