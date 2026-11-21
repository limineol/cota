import { Context, DateTime, Effect, Layer, Option } from "effect";
import { SignIns } from "#modules/sign-in/02-application/interfaces/sign-ins.repository.ts";
import type { SignIn } from "#modules/sign-in/03-domain/sign-in.entity.ts";
import { SignInId } from "#shared/03-domain/ids.ts";

/** What the in-memory store holds, for a test to look at. */
export class Kept extends Context.Service<
  Kept,
  { readonly signIns: () => ReadonlyArray<SignIn> }
>()("@cota/hub/sign-in/tests/Kept") {}

/** `SignIns` in memory, as the SQLite repository keeps them. */
export const layer: Layer.Layer<SignIns | Kept> = Layer.effectContext(
  Effect.sync(() => {
    const kept = new Map<SignInId, SignIn>();
    const signIns = SignIns.of({
      add: (signIn) =>
        Effect.sync(() => {
          const id = SignInId.make(
            Bun.randomUUIDv7("hex", DateTime.toEpochMillis(signIn.createdAt)),
          );
          const added = { ...signIn, id };
          kept.set(id, added);
          return added;
        }),
      findByDigest: (digest) =>
        Effect.sync(() =>
          Option.fromUndefinedOr(
            [...kept.values()].find((each) => each.tokenDigest === digest),
          ),
        ),
      all: Effect.sync(() => [...kept.values()]),
      touch: (id, at) =>
        Effect.sync(() => {
          const signIn = kept.get(id);
          if (signIn !== undefined) kept.set(id, { ...signIn, lastUsedAt: at });
        }),
      revoke: (ids, at) =>
        Effect.sync(() => {
          for (const id of ids) {
            const signIn = kept.get(id);
            if (signIn !== undefined && Option.isNone(signIn.revokedAt)) {
              kept.set(id, { ...signIn, revokedAt: Option.some(at) });
            }
          }
        }),
      forget: (endedBefore) =>
        Effect.sync(() => {
          for (const [id, signIn] of kept) {
            const ended =
              DateTime.isLessThan(signIn.expiresAt, endedBefore) ||
              Option.exists(signIn.revokedAt, (at) =>
                DateTime.isLessThan(at, endedBefore),
              );
            if (ended) kept.delete(id);
          }
        }),
    });
    return Context.make(SignIns, signIns).pipe(
      Context.add(Kept, Kept.of({ signIns: () => [...kept.values()] })),
    );
  }),
);
