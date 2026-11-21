# Proofs of the laws in LAWS.bend.
#
# Bend has no tactics: a proof is a def whose type is the law. `match`
# splits into cases, a recursive call is the induction hypothesis, and
# `%e : P` rewrites the goal with the equation e (P is the goal with `_`
# where e's right side stands; the goal becomes P with e's left side
# there). A match cannot inspect a computed value, so a helper takes the
# value `b` with its evidence `{b == computed}` and matches on `b`.

import Base
import ./model.bend as F
import ./LAWS.bend as Laws

# Clashes
# -------
# A hypothesis such as {F.Keep{} == F.Divert{to, reset}} is impossible.
# Rewriting the goal through a type that is the goal on one side and
# Unit on the other turns it into Unit, proved by Unit{}.

def KeepOr(d: F.Decision, t: Type) -> Type:
  match d:
    case F.Keep{}:
      Unit
    case F.Divert{p, r}:
      t

def IfTrue(b: Bool, t: Type) -> Type:
  match b:
    case True{}:
      t
    case False{}:
      Unit

def IfFalse(b: Bool, t: Type) -> Type:
  match b:
    case True{}:
      Unit
    case False{}:
      t

def IfZero(n: Nat, t: Type) -> Type:
  match n:
    case 0n:
      t
    case 1n+p:
      Unit

def IfSucc(n: Nat, t: Type) -> Type:
  match n:
    case 0n:
      Unit
    case 1n+p:
      t

def pred(n: Nat) -> Nat:
  match n:
    case 0n:
      0n
    case 1n+p:
      p

def diverted_pool(d: F.Decision) -> Nat:
  match d:
    case F.Keep{}:
      0n
    case F.Divert{p, r}:
      p

# Booleans and Nat comparisons
# ----------------------------
# Base's Nat has almost no lemmas; these are the few the laws need,
# each by induction on the numbers.

def and_false(b: Bool) -> {False{} == Bool.and(b, False{}) : Bool}:
  match b:
    case True{}:
      {==}
    case False{}:
      {==}

def is_eq_false(a: Nat, b: Nat, ne: {a != b : Nat}) -> {False{} == Nat.is_eq(a, b) : Bool}:
  match a b:
    case 0n 0n:
      Empty.absurd({False{} == True{} : Bool}, ne({==}))
    case 0n 1n+q:
      {==}
    case 1n+p 0n:
      {==}
    case 1n+p 1n+q:
      is_eq_false(p, q, e => ne(Equal.cong(Nat, Nat, k => 1n+k, p, q, e)))

def eq_of_is_eq(a: Nat, b: Nat, h: {True{} == Nat.is_eq(a, b) : Bool}) -> {a == b : Nat}:
  match a b:
    case 0n 0n:
      {==}
    case 0n 1n+q:
      %h : IfFalse(_, {0n == 1n+q : Nat})
      Unit{}
    case 1n+p 0n:
      %h : IfFalse(_, {1n+p == 0n : Nat})
      Unit{}
    case 1n+p 1n+q:
      %eq_of_is_eq(p, q, h) : {1n+p == 1n+_ : Nat}
      {==}

def not_eq(a: Nat, b: Nat, e: {False{} == Nat.is_eq(a, b) : Bool}, eq: {a == b : Nat}) -> Empty:
  match a b:
    case 0n 0n:
      %e : IfTrue(_, Empty)
      Unit{}
    case 0n 1n+q:
      %eq : IfSucc(_, Empty)
      Unit{}
    case 1n+p 0n:
      %eq : IfZero(_, Empty)
      Unit{}
    case 1n+p 1n+q:
      not_eq(p, q, e, Equal.cong(Nat, Nat, k => pred(k), 1n+p, 1n+q, eq))

def zero_le(a: Nat) -> {Nat.is_le(0n, a) == True{} : Bool}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      {==}

def le_refl(a: Nat) -> {Nat.is_le(a, a) == True{} : Bool}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      le_refl(p)

def le_trans(a: Nat, b: Nat, c: Nat, ab: {Nat.is_le(a, b) == True{} : Bool}, bc: {Nat.is_le(b, c) == True{} : Bool}) -> {Nat.is_le(a, c) == True{} : Bool}:
  match a b c:
    case 0n b c:
      zero_le(c)
    case 1n+p 0n c:
      %ab : IfTrue(_, {Nat.is_le(1n+p, c) == True{} : Bool})
      Unit{}
    case 1n+p 1n+q 0n:
      %bc : IfTrue(_, {Nat.is_le(1n+p, 0n) == True{} : Bool})
      Unit{}
    case 1n+p 1n+q 1n+r:
      le_trans(p, q, r, ab, bc)

def le_antisym(a: Nat, b: Nat, ab: {Nat.is_le(a, b) == True{} : Bool}, ba: {Nat.is_le(b, a) == True{} : Bool}) -> {a == b : Nat}:
  match a b:
    case 0n 0n:
      {==}
    case 0n 1n+q:
      %ba : IfTrue(_, {0n == 1n+q : Nat})
      Unit{}
    case 1n+p 0n:
      %ab : IfTrue(_, {1n+p == 0n : Nat})
      Unit{}
    case 1n+p 1n+q:
      %le_antisym(p, q, ab, ba) : {1n+p == 1n+_ : Nat}
      {==}

def max_le(a: Nat, b: Nat, c: Nat, ha: {Nat.is_le(a, c) == True{} : Bool}, hb: {Nat.is_le(b, c) == True{} : Bool}) -> {Nat.is_le(Nat.max(a, b), c) == True{} : Bool}:
  match a b c:
    case 0n b c:
      hb
    case 1n+p 0n c:
      ha
    case 1n+p 1n+q 0n:
      %ha : IfTrue(_, {Nat.is_le(Nat.max(1n+p, 1n+q), 0n) == True{} : Bool})
      Unit{}
    case 1n+p 1n+q 1n+r:
      max_le(p, q, r, ha, hb)

def le_max_l(a: Nat, b: Nat) -> {Nat.is_le(a, Nat.max(a, b)) == True{} : Bool}:
  match a b:
    case 0n b:
      zero_le(b)
    case 1n+p 0n:
      le_refl(p)
    case 1n+p 1n+q:
      le_max_l(p, q)

def le_max_r(a: Nat, b: Nat) -> {Nat.is_le(b, Nat.max(a, b)) == True{} : Bool}:
  match a b:
    case 0n b:
      le_refl(b)
    case 1n+p 0n:
      {==}
    case 1n+p 1n+q:
      le_max_r(p, q)

def lt_false_of_le(a: Nat, b: Nat, h: {Nat.is_le(a, b) == True{} : Bool}) -> {False{} == Nat.is_lt(b, a) : Bool}:
  match a b:
    case 0n 0n:
      {==}
    case 0n 1n+q:
      {==}
    case 1n+p 0n:
      %h : IfTrue(_, {False{} == Nat.is_lt(0n, 1n+p) : Bool})
      Unit{}
    case 1n+p 1n+q:
      lt_false_of_le(p, q, h)

def le_of_not_lt(a: Nat, b: Nat, e: {False{} == Nat.is_lt(b, a) : Bool}) -> {Nat.is_le(a, b) == True{} : Bool}:
  match a b:
    case 0n 0n:
      {==}
    case 0n 1n+q:
      {==}
    case 1n+p 0n:
      %e : IfTrue(_, {Nat.is_le(1n+p, 0n) == True{} : Bool})
      Unit{}
    case 1n+p 1n+q:
      le_of_not_lt(p, q, e)

# F1. No login, no diversion
# --------------------------
# decide's first rule returns Keep for a request without a login, before
# it looks at the policy or at parked, so both sides compute to Keep.

def Laws.f1_no_login_no_diversion(policy, parked, pool, model, now):
  {==}

# F2. Own fallback only
# ---------------------
# Divert is only built from the request's pool's fallback, by rule 3. In
# every other branch the hypothesis says Keep equals Divert, a clash.

def parked_divert_pool(f: Nat, until: Maybe<&2, Nat>, -to: Nat, -reset: Nat, h: {F.decide.parked(f, until) == F.Divert{to, reset} : F.Decision}) -> {f == to : Nat}:
  match until:
    case Some{r}:
      Equal.cong(F.Decision, Nat, d => diverted_pool(d), F.Divert{f, r}, F.Divert{to, reset}, h)
    case None{}:
      %h : KeepOr(_, {f == to : Nat})
      Unit{}

def logged_in_divert_pool(fallback: Maybe<&2, Nat>, until: Maybe<&2, Nat>, -to: Nat, -reset: Nat, h: {F.decide.logged_in(fallback, until) == F.Divert{to, reset} : F.Decision}) -> {fallback == Some{to} : Maybe<&2, Nat>}:
  match fallback:
    case None{}:
      %h : KeepOr(_, {None{} == Some{to} : Maybe<&2, Nat>})
      Unit{}
    case Some{f}:
      %parked_divert_pool(f, until, to, reset, h) : {Some{f} == Some{_} : Maybe<&2, Nat>}
      {==}

def Laws.f2_own_fallback_only(policy, parked, pool, login, model, now, to, reset, diverted):
  match login:
    case None{}:
      %diverted : KeepOr(_, {F.fallback_of(policy, pool) == Some{to} : Maybe<&2, Nat>})
      Unit{}
    case Some{l}:
      logged_in_divert_pool(F.fallback_of(policy, pool), F.parkedUntil(parked, l, model, now), to, reset, diverted)

# F3. Isolation
# -------------
# A refusal for another login or model contributes no reset to the
# latest reset for this login and model (is_for is False), so the
# decision computes to the same thing with or without it.

def not_for(+l: Nat, +m: Nat, -at: Nat, -g: Maybe<&2, Nat>, +l2: Nat, +m2: Nat, other: Or({Some{l} != Some{l2} : Maybe<&2, Nat>}, {m != m2 : Nat}))
  -> {False{} == F.is_for(F.Refusal{l, m, at, g}, l2, m2) : Bool}:
  match other:
    case Inl{ne}:
      %is_eq_false(l, l2, e => ne(Equal.cong(Nat, Maybe<&2, Nat>, k => Some{k}, l, l2, e))) : {False{} == Bool.and(_, Nat.is_eq(m, m2)) : Bool}
      {==}
    case Inr{ne}:
      %is_eq_false(m, m2, ne) : {False{} == Bool.and(Nat.is_eq(l, l2), _) : Bool}
      and_false(Nat.is_eq(l, l2))

def Laws.f3_isolation(policy, parked, pool, login, model, now, refused_login, refused_model, refused_at, reset, other):
  match login:
    case None{}:
      {==}
    case Some{l}:
      %not_for(refused_login, refused_model, refused_at, reset, l, model, other) : {F.decide.logged_in(F.fallback_of(policy, pool), F.reset_if_after(F.later(F.reset_if(_, F.parks_until(F.Refusal{refused_login, refused_model, refused_at, reset})), F.latest_reset(parked, l, model)), now)) == F.decide(policy, parked, F.Request{pool, Some{l}, model}, now) : F.Decision}
      {==}

# F5. Temporary
# -------------
# If every refusal for the login and model parks until `now` or earlier,
# so does their latest reset (induction on parked, with max_le), so
# parkedUntil is none at `now` and every rule left answers Keep.

# a time that is absent, or at or before `now`
def NoneAfter(m: Maybe<&2, Nat>, -now: Nat) -> Type:
  match m:
    case None{}:
      Unit
    case Some{x}:
      {Nat.is_le(x, now) == True{} : Bool}

def later_by(a: Maybe<&2, Nat>, b: Maybe<&2, Nat>, now: Nat, ha: NoneAfter(a, now), hb: NoneAfter(b, now)) -> NoneAfter(F.later(a, b), now):
  match a b:
    case None{} _:
      hb
    case Some{x} None{}:
      ha
    case Some{x} Some{y}:
      max_le(x, y, now, ha, hb)

def by_head(+l: Nat, +m: Nat, +at: Nat, +g: Maybe<&2, Nat>, +login: Nat, +model: Nat, +now: Nat, +rest: List<&2, F.Refusal>,
  imp: {l == login : Nat} -> {m == model : Nat} -> {Nat.is_le(F.parks_until(F.Refusal{l, m, at, g}), now) == True{} : Bool},
  ih: NoneAfter(F.latest_reset(rest, login, model), now),
  b1: Bool, e1: {b1 == Nat.is_eq(l, login) : Bool},
  b2: Bool, e2: {b2 == Nat.is_eq(m, model) : Bool})
  -> NoneAfter(F.later(F.reset_if(Bool.and(b1, b2), F.parks_until(F.Refusal{l, m, at, g})), F.latest_reset(rest, login, model)), now):
  match b1 b2:
    case True{} True{}:
      later_by(Some{F.parks_until(F.Refusal{l, m, at, g})}, F.latest_reset(rest, login, model), now, imp(eq_of_is_eq(l, login, e1), eq_of_is_eq(m, model, e2)), ih)
    case True{} False{}:
      ih
    case False{} _:
      ih

def latest_reset_by(parked: List<&2, F.Refusal>, +login: Nat, +model: Nat, +now: Nat, all: Laws.AllResetBy(parked, login, model, now)) -> NoneAfter(F.latest_reset(parked, login, model), now):
  match parked:
    case Nil{}:
      Unit{}
    case Con{F.Refusal{+l, +m, +at, +g}, +rest}:
      (imp, all_rest) = all
      by_head(l, m, at, g, login, model, now, rest, imp, latest_reset_by(rest, login, model, now, all_rest), Nat.is_eq(l, login), {==}, Nat.is_eq(m, model), {==})

def logged_in_none(fallback: Maybe<&2, Nat>) -> {F.decide.logged_in(fallback, None{}) == F.Keep{} : F.Decision}:
  match fallback:
    case None{}:
      {==}
    case Some{f}:
      {==}

def kept_after(fallback: Maybe<&2, Nat>, latest: Maybe<&2, Nat>, +now: Nat, h: NoneAfter(latest, now)) -> {F.decide.logged_in(fallback, F.reset_if_after(latest, now)) == F.Keep{} : F.Decision}:
  match latest:
    case None{}:
      logged_in_none(fallback)
    case Some{+x}:
      %lt_false_of_le(x, now, h) : {F.decide.logged_in(fallback, F.reset_if(_, x)) == F.Keep{} : F.Decision}
      logged_in_none(fallback)

def Laws.f5_temporary(policy, parked, pool, login, model, now, reached):
  kept_after(F.fallback_of(policy, pool), F.latest_reset(parked, login, model), now, latest_reset_by(parked, login, model, now, reached))

# F4. Cause
# ---------
# By induction on parked, either every refusal for the login and model
# has reset by `now` (and F5's argument shows the request is kept, a
# clash with the hypothesis), or one of them parks past `now`, and that
# refusal is the witness.

# a recorded refusal for `login` and `model` that parks past `now`
def Cause(parked: List<&2, F.Refusal>, -login: Nat, -model: Nat, -now: Nat) -> Type:
  &at: Nat -> &given: Maybe<&2, Nat> -> Laws.Recorded(F.Refusal{login, model, at, given}, parked) & {Nat.is_lt(now, F.parks_until(F.Refusal{login, model, at, given})) == True{} : Bool}

def keep_tail(+l: Nat, +m: Nat, +at: Nat, +g: Maybe<&2, Nat>, +login: Nat, +model: Nat, +now: Nat, +rest: List<&2, F.Refusal>,
  imp: {l == login : Nat} -> {m == model : Nat} -> {Nat.is_le(F.parks_until(F.Refusal{l, m, at, g}), now) == True{} : Bool},
  tail: Or(Laws.AllResetBy(rest, login, model, now), Cause(rest, login, model, now)))
  -> Or(Laws.AllResetBy(F.Refusal{l, m, at, g} <> rest, login, model, now), Cause(F.Refusal{l, m, at, g} <> rest, login, model, now)):
  match tail:
    case Inl{all}:
      Inl{(imp, all)}
    case Inr{cause}:
      (at2, g2, recorded, after) = cause
      Inr{(at2, g2, Inr{recorded}, after)}

def split_head(+l: Nat, +m: Nat, +at: Nat, +g: Maybe<&2, Nat>, +login: Nat, +model: Nat, +now: Nat, +rest: List<&2, F.Refusal>,
  tail: Or(Laws.AllResetBy(rest, login, model, now), Cause(rest, login, model, now)),
  b1: Bool, e1: {b1 == Nat.is_eq(l, login) : Bool},
  b2: Bool, e2: {b2 == Nat.is_eq(m, model) : Bool},
  b3: Bool, e3: {b3 == Nat.is_lt(now, F.parks_until(F.Refusal{l, m, at, g})) : Bool})
  -> Or(Laws.AllResetBy(F.Refusal{l, m, at, g} <> rest, login, model, now), Cause(F.Refusal{l, m, at, g} <> rest, login, model, now)):
  match b1 b2 b3:
    case True{} True{} True{}:
      %eq_of_is_eq(l, login, e1) : Or(Laws.AllResetBy(F.Refusal{l, m, at, g} <> rest, _, model, now), Cause(F.Refusal{l, m, at, g} <> rest, _, model, now))
      %eq_of_is_eq(m, model, e2) : Or(Laws.AllResetBy(F.Refusal{l, m, at, g} <> rest, l, _, now), Cause(F.Refusal{l, m, at, g} <> rest, l, _, now))
      Inr{(at, g, Inl{{==}}, Equal.sym(Bool, True{}, Nat.is_lt(now, F.parks_until(F.Refusal{l, m, at, g})), e3))}
    case True{} True{} False{}:
      keep_tail(l, m, at, g, login, model, now, rest, el => em => le_of_not_lt(F.parks_until(F.Refusal{l, m, at, g}), now, e3), tail)
    case True{} False{} _:
      keep_tail(l, m, at, g, login, model, now, rest, el => em => Empty.absurd({Nat.is_le(F.parks_until(F.Refusal{l, m, at, g}), now) == True{} : Bool}, not_eq(m, model, e2, em)), tail)
    case False{} _ _:
      keep_tail(l, m, at, g, login, model, now, rest, el => em => Empty.absurd({Nat.is_le(F.parks_until(F.Refusal{l, m, at, g}), now) == True{} : Bool}, not_eq(l, login, e1, el)), tail)

def split(parked: List<&2, F.Refusal>, +login: Nat, +model: Nat, +now: Nat) -> Or(Laws.AllResetBy(parked, login, model, now), Cause(parked, login, model, now)):
  match parked:
    case Nil{}:
      Inl{Unit{}}
    case Con{F.Refusal{+l, +m, +at, +g}, +rest}:
      split_head(l, m, at, g, login, model, now, rest, split(rest, login, model, now), Nat.is_eq(l, login), {==}, Nat.is_eq(m, model), {==}, Nat.is_lt(now, F.parks_until(F.Refusal{l, m, at, g})), {==})

# what F4 concludes about a diverted request with `login`
def CauseOf(login: Maybe<&2, Nat>, parked: List<&2, F.Refusal>, -model: Nat, -now: Nat) -> Type:
  &refused_login: Nat -> &at: Nat -> &given: Maybe<&2, Nat> -> {login == Some{refused_login} : Maybe<&2, Nat>} & Laws.Recorded(F.Refusal{refused_login, model, at, given}, parked) & {Nat.is_lt(now, F.parks_until(F.Refusal{refused_login, model, at, given})) == True{} : Bool}

def diverted_by_cause(policy: List<&2, F.Fallback>, +parked: List<&2, F.Refusal>, +pool: Nat, +login: Nat, +model: Nat, +now: Nat, -to: Nat, -reset: Nat,
  diverted: {F.decide(policy, parked, F.Request{pool, Some{login}, model}, now) == F.Divert{to, reset} : F.Decision},
  found: Or(Laws.AllResetBy(parked, login, model, now), Cause(parked, login, model, now)))
  -> CauseOf(Some{login}, parked, model, now):
  match found:
    case Inl{all}:
      kept = kept_after(F.fallback_of(policy, pool), F.latest_reset(parked, login, model), now, latest_reset_by(parked, login, model, now, all))
      %Equal.trans(F.Decision, F.Keep{}, F.decide(policy, parked, F.Request{pool, Some{login}, model}, now), F.Divert{to, reset}, Equal.sym(F.Decision, F.decide(policy, parked, F.Request{pool, Some{login}, model}, now), F.Keep{}, kept), diverted) : KeepOr(_, CauseOf(Some{login}, parked, model, now))
      Unit{}
    case Inr{cause}:
      (at, given, recorded, after) = cause
      (login, at, given, {==}, recorded, after)

def Laws.f4_cause(policy, parked, pool, login, model, now, to, reset, diverted):
  match login:
    case None{}:
      %diverted : KeepOr(_, CauseOf(None{}, parked, model, now))
      Unit{}
    case Some{+l}:
      diverted_by_cause(policy, parked, pool, l, model, now, to, reset, diverted, split(parked, l, model, now))

# F6. Order-free
# --------------
# decide reads parked only through the latest reset for the request's
# login and model. If every refusal of one list is in another, the first
# list's latest reset is no later than the second's; two lists with the
# same refusals therefore have the same latest reset, and record_all
# keeps the refusals of the lists it records, whatever their order.

# `a` is no later than `b`, where an absent time is earliest
def Le(a: Maybe<&2, Nat>, b: Maybe<&2, Nat>) -> Type:
  match a b:
    case None{} _:
      Unit
    case Some{x} None{}:
      Empty
    case Some{x} Some{y}:
      {Nat.is_le(x, y) == True{} : Bool}

def le_antisym_maybe(a: Maybe<&2, Nat>, b: Maybe<&2, Nat>, ab: Le(a, b), ba: Le(b, a)) -> {a == b : Maybe<&2, Nat>}:
  match a b:
    case None{} None{}:
      {==}
    case None{} Some{y}:
      Empty.absurd({None{} == Some{y} : Maybe<&2, Nat>}, ba)
    case Some{x} None{}:
      Empty.absurd({Some{x} == None{} : Maybe<&2, Nat>}, ab)
    case Some{x} Some{y}:
      %le_antisym(x, y, ab, ba) : {Some{x} == Some{_} : Maybe<&2, Nat>}
      {==}

def later_le(a: Maybe<&2, Nat>, b: Maybe<&2, Nat>, c: Maybe<&2, Nat>, ac: Le(a, c), bc: Le(b, c)) -> Le(F.later(a, b), c):
  match a b c:
    case None{} _ _:
      bc
    case Some{x} None{} _:
      ac
    case Some{x} Some{y} None{}:
      ac
    case Some{x} Some{y} Some{z}:
      max_le(x, y, z, ac, bc)

def le_later_l(+a: Maybe<&2, Nat>, b: Maybe<&2, Nat>) -> Le(a, F.later(a, b)):
  match a b:
    case None{} _:
      Unit{}
    case Some{+x} None{}:
      le_refl(x)
    case Some{+x} Some{y}:
      le_max_l(x, y)

def le_later_r(a: Maybe<&2, Nat>, b: Maybe<&2, Nat>, c: Maybe<&2, Nat>, ab: Le(a, b)) -> Le(a, F.later(c, b)):
  match a b c:
    case None{} _ _:
      Unit{}
    case Some{x} None{} _:
      Empty.absurd(Le(Some{x}, F.later(c, None{})), ab)
    case Some{x} Some{y} None{}:
      ab
    case Some{x} Some{+y} Some{+z}:
      le_trans(x, y, Nat.max(z, y), ab, le_max_r(z, y))

# the reset a refusal contributes for `login` and `model`
def own(+refusal: F.Refusal, +login: Nat, +model: Nat) -> Maybe<&2, Nat>:
  F.reset_if(F.is_for(refusal, login, model), F.parks_until(refusal))

def recorded_le(+refusal: F.Refusal, parked: List<&2, F.Refusal>, +login: Nat, +model: Nat, h: Laws.Recorded(refusal, parked)) -> Le(own(refusal, login, model), F.latest_reset(parked, login, model)):
  match parked:
    case Nil{}:
      match h:
    case Con{+r, +rest}:
      match h:
        case Inl{same}:
          %same : Le(own(_, login, model), F.later(own(r, login, model), F.latest_reset(rest, login, model)))
          le_later_l(own(r, login, model), F.latest_reset(rest, login, model))
        case Inr{later}:
          le_later_r(own(refusal, login, model), F.latest_reset(rest, login, model), own(r, login, model), recorded_le(refusal, rest, login, model, later))

def within_le(a: List<&2, F.Refusal>, +b: List<&2, F.Refusal>, +login: Nat, +model: Nat, w: Laws.Within(a, b)) -> Le(F.latest_reset(a, login, model), F.latest_reset(b, login, model)):
  match a:
    case Nil{}:
      Unit{}
    case Con{+r, +rest}:
      (here, others) = w
      later_le(own(r, login, model), F.latest_reset(rest, login, model), F.latest_reset(b, login, model), recorded_le(r, b, login, model, here), within_le(rest, b, login, model, others))

def within_cons(a: List<&2, F.Refusal>, -m: List<&2, F.Refusal>, -r: F.Refusal, w: Laws.Within(a, m)) -> Laws.Within(a, r <> m):
  match a:
    case Nil{}:
      Unit{}
    case Con{x, rest}:
      (here, others) = w
      (Inr{here}, within_cons(rest, m, r, others))

def within_refl(+a: List<&2, F.Refusal>) -> Laws.Within(a, a):
  match a:
    case Nil{}:
      Unit{}
    case Con{+x, +rest}:
      (Inl{{==}}, within_cons(rest, rest, x, within_refl(rest)))

def recorded_after(-x: F.Refusal, xs: List<&2, F.Refusal>, p: List<&2, F.Refusal>, h: Laws.Recorded(x, p)) -> Laws.Recorded(x, F.record_all(xs, p)):
  match xs:
    case Nil{}:
      h
    case Con{r, rest}:
      recorded_after(x, rest, r <> p, Inr{h})

def recorded_in(-x: F.Refusal, xs: List<&2, F.Refusal>, p: List<&2, F.Refusal>, h: Laws.Recorded(x, xs)) -> Laws.Recorded(x, F.record_all(xs, p)):
  match xs:
    case Nil{}:
      match h:
    case Con{r, rest}:
      match h:
        case Inl{same}:
          recorded_after(x, rest, r <> p, Inl{same})
        case Inr{later}:
          recorded_in(x, rest, r <> p, later)

def within_after(a: List<&2, F.Refusal>, +xs: List<&2, F.Refusal>, +p: List<&2, F.Refusal>, w: Laws.Within(a, p)) -> Laws.Within(a, F.record_all(xs, p)):
  match a:
    case Nil{}:
      Unit{}
    case Con{x, rest}:
      (here, others) = w
      (recorded_after(x, xs, p, here), within_after(rest, xs, p, others))

def within_in(a: List<&2, F.Refusal>, +xs: List<&2, F.Refusal>, +p: List<&2, F.Refusal>, w: Laws.Within(a, xs)) -> Laws.Within(a, F.record_all(xs, p)):
  match a:
    case Nil{}:
      Unit{}
    case Con{x, rest}:
      (here, others) = w
      (recorded_in(x, xs, p, here), within_in(rest, xs, p, others))

def all_within(a: List<&2, F.Refusal>, p: List<&2, F.Refusal>, -m: List<&2, F.Refusal>, wa: Laws.Within(a, m), wp: Laws.Within(p, m)) -> Laws.Within(F.record_all(a, p), m):
  match a:
    case Nil{}:
      wp
    case Con{r, rest}:
      (here, others) = wa
      all_within(rest, r <> p, m, others, (here, wp))

def recorded_all_within(+a: List<&2, F.Refusal>, +b: List<&2, F.Refusal>, +p: List<&2, F.Refusal>, ab: Laws.Within(a, b)) -> Laws.Within(F.record_all(a, p), F.record_all(b, p)):
  all_within(a, p, F.record_all(b, p), within_in(a, b, p, ab), within_after(p, b, p, within_refl(p)))

def Laws.f6_order_free(policy, parked, refusals, others, covered, covering, request, now):
  match request:
    case F.Request{pool, None{}, model}:
      {==}
    case F.Request{pool, Some{+login}, +model}:
      %le_antisym_maybe(F.latest_reset(F.record_all(refusals, parked), login, model), F.latest_reset(F.record_all(others, parked), login, model), within_le(F.record_all(refusals, parked), F.record_all(others, parked), login, model, recorded_all_within(refusals, others, parked, covered)), within_le(F.record_all(others, parked), F.record_all(refusals, parked), login, model, recorded_all_within(others, refusals, parked, covering))) : {F.decide.logged_in(F.fallback_of(policy, pool), F.reset_if_after(F.latest_reset(F.record_all(refusals, parked), login, model), now)) == F.decide.logged_in(F.fallback_of(policy, pool), F.reset_if_after(_, now)) : F.Decision}
      {==}
