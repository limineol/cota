# The laws of docs/specs/fallback/spec.md, stated over the model in
# model.bend. Each law quotes the spec's sentence above it.
#
# Reading a law: `for x: T` is "for every x of type T"; `for h: P` is a
# hypothesis named h; `exs y: T` is "there is a y"; `{a == b : T}` says
# a equals b, and `{a != b : T}` that it does not; `A & B` is both,
# `Or(A, B)` either, and `A -> B` "if A then B". A `+` before a name
# only lets the proof use that value twice; it changes no meaning.
#
# `parked` ranges over every list of refusals. `record` puts a refusal
# at the head of the list and `empty` is the empty list, so every list
# is what some history of refusals leaves behind: "for every parked" is
# "after every history". `policy` ranges over every list of lines, and
# a pool's fallback pool is the one named by the first line for it, so
# every fallback policy is one of them.
#
# A refusal's reset is `F.parks_until`: the reset the provider gave, or
# 15 minutes after the refusal when it gave none, as `record` reads it.
#
# F7 (forgetting is invisible) is not modelled: `forget` is held by
# property tests of the shipped code only.

import Base
import ./model.bend as F

# `refusal` is one of the refusals in `parked`
def Recorded(-refusal: F.Refusal, parked: List<&2, F.Refusal>) -> Type:
  match parked:
    case Nil{}:
      Empty
    case Con{r, rest}:
      Or({r == refusal : F.Refusal}, Recorded(refusal, rest))

# every refusal in `a` is also in `b`. Within(a, b) and Within(b, a)
# together say that a and b hold the same refusals, in any order and
# any number of times each.
def Within(a: List<&2, F.Refusal>, -b: List<&2, F.Refusal>) -> Type:
  match a:
    case Nil{}:
      Unit
    case Con{r, rest}:
      Recorded(r, b) & Within(rest, b)

# every refusal in `parked` for `login` and `model` parks until `now`
# or earlier: `now` has reached the latest of their resets
def AllResetBy(parked: List<&2, F.Refusal>, -login: Nat, -model: Nat, -now: Nat) -> Type:
  match parked:
    case Nil{}:
      Unit
    case Con{F.Refusal{l, m, refused_at, reset}, rest}:
      ({l == login : Nat} -> {m == model : Nat} -> {Nat.is_le(F.parks_until(F.Refusal{l, m, refused_at, reset}), now) == True{} : Bool}) & AllResetBy(rest, login, model, now)

# F1. No login, no diversion. A request without a login is kept,
# whatever was refused before it.
law f1_no_login_no_diversion:
  for policy: List<&2, F.Fallback>
  for parked: List<&2, F.Refusal>
  for pool: Nat
  for model: Nat
  for now: Nat
  {F.decide(policy, parked, F.Request{pool, None{}, model}, now) == F.Keep{} : F.Decision}

# F2. Own fallback only. A diverted request goes to the fallback pool of
# the pool it bills, and to no other.
law f2_own_fallback_only:
  for policy: List<&2, F.Fallback>
  for parked: List<&2, F.Refusal>
  for pool: Nat
  for login: Maybe<&2, Nat>
  for model: Nat
  for now: Nat
  for to: Nat
  for reset: Nat
  for diverted: {F.decide(policy, parked, F.Request{pool, login, model}, now) == F.Divert{to, reset} : F.Decision}
  {F.fallback_of(policy, pool) == Some{to} : Maybe<&2, Nat>}

# F3. Isolation. Recording a refusal for another login, or for another
# model, never changes the decision for a request.
law f3_isolation:
  for policy: List<&2, F.Fallback>
  for parked: List<&2, F.Refusal>
  for pool: Nat
  for login: Maybe<&2, Nat>
  for model: Nat
  for now: Nat
  for refused_login: Nat
  for refused_model: Nat
  for refused_at: Nat
  for reset: Maybe<&2, Nat>
  for other: Or({Some{refused_login} != login : Maybe<&2, Nat>}, {refused_model != model : Nat})
  {F.decide(policy, F.record(parked, F.Refusal{refused_login, refused_model, refused_at, reset}), F.Request{pool, login, model}, now) == F.decide(policy, parked, F.Request{pool, login, model}, now) : F.Decision}

# F4. Cause. A request is diverted only if a refusal for its own login
# and model was recorded with a reset after `now`.
law f4_cause:
  for policy: List<&2, F.Fallback>
  for +parked: List<&2, F.Refusal>
  for pool: Nat
  for login: Maybe<&2, Nat>
  for +model: Nat
  for +now: Nat
  for to: Nat
  for reset: Nat
  for diverted: {F.decide(policy, parked, F.Request{pool, login, model}, now) == F.Divert{to, reset} : F.Decision}
  exs refused_login: Nat
  exs refused_at: Nat
  exs given: Maybe<&2, Nat>
  {login == Some{refused_login} : Maybe<&2, Nat>} & Recorded(F.Refusal{refused_login, model, refused_at, given}, parked) & {Nat.is_lt(now, F.parks_until(F.Refusal{refused_login, model, refused_at, given})) == True{} : Bool}

# F5. Temporary. Once `now` reaches the latest reset recorded for a login
# and model, that login's requests for that model are kept again.
law f5_temporary:
  for policy: List<&2, F.Fallback>
  for +parked: List<&2, F.Refusal>
  for pool: Nat
  for +login: Nat
  for +model: Nat
  for +now: Nat
  for reached: AllResetBy(parked, login, model, now)
  {F.decide(policy, parked, F.Request{pool, Some{login}, model}, now) == F.Keep{} : F.Decision}

# F6. Order-free. Recording the same refusals in any order, and any
# number of times each, gives the same decisions.
law f6_order_free:
  for policy: List<&2, F.Fallback>
  for +parked: List<&2, F.Refusal>
  for +refusals: List<&2, F.Refusal>
  for +others: List<&2, F.Refusal>
  for covered: Within(refusals, others)
  for covering: Within(others, refusals)
  for request: F.Request
  for now: Nat
  {F.decide(policy, F.record_all(refusals, parked), request, now) == F.decide(policy, F.record_all(others, parked), request, now) : F.Decision}
