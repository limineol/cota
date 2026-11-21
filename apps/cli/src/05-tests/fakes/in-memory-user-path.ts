import { Effect, Layer } from "effect";
import { UserPath } from "#02-application/interfaces/user-path.ts";

/** The user's `Path` of a Windows machine, in memory. */
export const make = (
  initial = "",
): {
  readonly current: () => string;
  readonly layer: Layer.Layer<UserPath>;
} => {
  let path = initial;
  return {
    current: () => path,
    layer: Layer.succeed(
      UserPath,
      UserPath.of({
        read: Effect.sync(() => path),
        write: (written) =>
          Effect.sync(() => {
            path = written;
          }),
      }),
    ),
  };
};
