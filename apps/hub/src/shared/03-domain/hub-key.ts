import { Schema } from "effect";
import { HubKeyName } from "./ids.ts";

/** What a hub key opens: the pools of one kind, or, for `reader`, no pool. */
export const Scope = Schema.Literals(["subscription", "keyed", "reader"]);
export type Scope = typeof Scope.Type;

export const HubKey = Schema.Struct({ name: HubKeyName, scope: Scope });
export type HubKey = typeof HubKey.Type;
