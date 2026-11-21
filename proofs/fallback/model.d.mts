export type Nat = number;

export type Maybe<A> =
  | { readonly $: "None" }
  | { readonly $: "Some"; readonly value: A };

export type List<A> =
  | { readonly $: "Nil" }
  | { readonly $: "Con"; readonly head: A; readonly tail: List<A> };

export interface Request {
  readonly $: "Request";
  readonly pool: Nat;
  readonly login: Maybe<Nat>;
  readonly model: Nat;
}

export interface Refusal {
  readonly $: "Refusal";
  readonly login: Nat;
  readonly model: Nat;
  readonly refused_at: Nat;
  readonly reset: Maybe<Nat>;
}

export type Decision =
  | { readonly $: "Keep" }
  | { readonly $: "Divert"; readonly pool: Nat; readonly reset: Nat };

export interface Fallback {
  readonly $: "Fallback";
  readonly pool: Nat;
  readonly fallback: Nat;
}

declare const model: {
  readonly empty: () => List<Refusal>;
  readonly record: (parked: List<Refusal>, refusal: Refusal) => List<Refusal>;
  readonly parkedUntil: (
    parked: List<Refusal>,
    login: Nat,
    model: Nat,
    now: Nat,
  ) => Maybe<Nat>;
  readonly decide: (
    policy: List<Fallback>,
    parked: List<Refusal>,
    request: Request,
    now: Nat,
  ) => Decision;
};

export default model;
