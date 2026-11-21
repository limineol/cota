/** How the owner signs in, as `GET /api/sign-in` answers. */
export interface WaysIn {
  readonly setUp: boolean;
  readonly password: boolean;
  readonly passkey: boolean;
}

/**
 * What the sign-in screen offers: on a hub that is not set up, the way to
 * setup; otherwise the password when the hub takes one, a passkey when the
 * hub keeps one and this browser offers passkeys here, and, when a passkey
 * is the only way in and this browser cannot use one here, the sentence that
 * says where it can (V39).
 */
export type Door =
  | { readonly _tag: "SetUp" }
  | {
      readonly _tag: "Open";
      readonly password: boolean;
      readonly passkey: boolean;
      readonly passkeyElsewhere: boolean;
    };

export const doorOf = (ways: WaysIn, passkeysHere: boolean): Door => {
  if (!ways.setUp) return { _tag: "SetUp" };
  return {
    _tag: "Open",
    password: ways.password,
    passkey: ways.passkey && passkeysHere,
    passkeyElsewhere: ways.passkey && !passkeysHere && !ways.password,
  };
};

/** Where the owner password is kept, as `GET /api/owner-password` answers. */
export type PasswordSource = "configuration" | "hub-store" | "none";

/**
 * What Settings offers to remove: turning the stored password off, which the
 * hub allows only while a passkey remains, and removing a passkey, which it
 * allows only while another passkey or a password remains. `turnOff` is
 * `"wants-a-passkey"` when the stored password is the last way in (V40).
 */
export const removalsOf = (source: PasswordSource, passkeys: number) => ({
  turnOff:
    source !== "hub-store"
      ? ("none" as const)
      : passkeys > 0
        ? ("offered" as const)
        : ("wants-a-passkey" as const),
  removePasskey: passkeys > 1 || (passkeys === 1 && source !== "none"),
});
