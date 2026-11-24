import { answer } from "./fake-api.ts";

/** `GET /api/me` with the owner signed in. */
export const owner = answer("sign-in", "me", {
  caller: "owner",
  hubKey: null,
  signIn: {
    id: "0b6f3c1e-5d2a-4c8e-9f1a-2e7d4b9c6a30",
    createdAt: "2026-11-15T09:00:00.000Z",
    expiresAt: "2026-12-15T09:00:00.000Z",
  },
});

/** `GET /api/display-names` with an owner's name, built-in names, and the owner's names for the pools given, by id. */
export const displayNamesWithPools = (
  pools: Readonly<Record<string, string>>,
) =>
  answer("display-names", "list", {
    names: [
      {
        kind: "client",
        key: "claude-code",
        name: "Claude Code",
        source: "built-in",
      },
      { kind: "client", key: "codex", name: "Codex", source: "built-in" },
      {
        kind: "client",
        key: "antigravity",
        name: "Antigravity",
        source: "built-in",
      },
      { kind: "machine", key: "tower", name: "Desk", source: "owner" },
      {
        kind: "model",
        key: "claude-opus-4-5",
        name: "Claude Opus 4.5",
        source: "built-in",
      },
      ...Object.entries(pools).map(([key, name]) => ({
        kind: "pool" as const,
        key,
        name,
        source: "owner" as const,
      })),
    ],
  });

/** `GET /api/display-names` with an owner's name, built-in names, and the owner's name for the pool `personal`. */
export const displayNames = displayNamesWithPools({
  personal: "Personal plan",
});

/** How the owner signs in, as `GET /api/sign-in` answers. */
export const signsInWith = (ways: {
  readonly setUp: boolean;
  readonly password: boolean;
  readonly passkey: boolean;
}) => answer("sign-in", "waysIn", ways);

/** A set-up hub whose owner password is its one way in. */
export const passwordOnly = signsInWith({
  setUp: true,
  password: true,
  passkey: false,
});
