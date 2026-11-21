# A model of the fallback decision in docs/specs/fallback/spec.md:
# decide, record and parkedUntil. forget is not modelled.
# Logins, models and pools are Nat ids; times are Nat milliseconds.

import Base

type Request is Data:
  Request{pool: Nat, login: Maybe<&2, Nat>, model: Nat}

type Refusal is Data:
  Refusal{login: Nat, model: Nat, refused_at: Nat, reset: Maybe<&2, Nat>}

type Decision is Data:
  Keep{}
  Divert{pool: Nat, reset: Nat}

# A fallback policy is a list of these lines: `pool`'s fallback pool is
# `fallback`.
type Fallback is Data:
  Fallback{pool: Nat, fallback: Nat}

# Policy
# ------

def keep_first(found: Bool, fallback: Nat, rest: Maybe<&2, Nat>) -> Maybe<&2, Nat>:
  match found:
    case True{}:
      Some{fallback}
    case False{}:
      rest

# the fallback pool of `pool`, read from the first line that names it
def fallback_of(policy: List<&2, Fallback>, +pool: Nat) -> Maybe<&2, Nat>:
  match policy:
    case Nil{}:
      None{}
    case Con{Fallback{p, fallback}, rest}:
      keep_first(Nat.is_eq(p, pool), fallback, fallback_of(rest, pool))

# Parked
# ------
# `parked` is every refusal recorded so far, newest first. A login and
# model are parked until the latest reset among the refusals for them.

def empty() -> List<&2, Refusal>:
  Nil{}

def record(parked: List<&2, Refusal>, refusal: Refusal) -> List<&2, Refusal>:
  refusal <> parked

# records each of `refusals` onto `parked`, first to last
def record_all(refusals: List<&2, Refusal>, parked: List<&2, Refusal>) -> List<&2, Refusal>:
  match refusals:
    case Nil{}:
      parked
    case Con{refusal, rest}:
      record_all(rest, record(parked, refusal))

# 15 minutes
def no_reset_parking() -> Nat:
  900000n

# a refusal parks until its reset, or for 15 minutes from when it was
# refused if the provider gave no reset
def parks_until(refusal: Refusal) -> Nat:
  match refusal:
    case Refusal{login, model, refused_at, None{}}:
      Nat.add(refused_at, no_reset_parking())
    case Refusal{login, model, refused_at, Some{reset}}:
      reset

def is_for(refusal: Refusal, +login: Nat, +model: Nat) -> Bool:
  match refusal:
    case Refusal{l, m, refused_at, reset}:
      Bool.and(Nat.is_eq(l, login), Nat.is_eq(m, model))

def reset_if(own: Bool, reset: Nat) -> Maybe<&2, Nat>:
  match own:
    case True{}:
      Some{reset}
    case False{}:
      None{}

# the later of two resets, where no reset is earliest
def later(a: Maybe<&2, Nat>, b: Maybe<&2, Nat>) -> Maybe<&2, Nat>:
  match a b:
    case None{} b:
      b
    case Some{x} None{}:
      Some{x}
    case Some{x} Some{y}:
      Some{Nat.max(x, y)}

# the latest reset among the refusals recorded for `login` and `model`
def latest_reset(parked: List<&2, Refusal>, +login: Nat, +model: Nat) -> Maybe<&2, Nat>:
  match parked:
    case Nil{}:
      None{}
    case Con{+refusal, rest}:
      later(reset_if(is_for(refusal, login, model), parks_until(refusal)), latest_reset(rest, login, model))

def reset_if_after(latest: Maybe<&2, Nat>, +now: Nat) -> Maybe<&2, Nat>:
  match latest:
    case None{}:
      None{}
    case Some{+reset}:
      reset_if(Nat.is_lt(now, reset), reset)

# the reset, if `login` and `model` are parked at `now`: at the reset
# itself they are not
def parkedUntil(parked: List<&2, Refusal>, +login: Nat, +model: Nat, +now: Nat) -> Maybe<&2, Nat>:
  reset_if_after(latest_reset(parked, login, model), now)

# Deciding
# --------
# The spec's four rules, first to last, read from `decide` upward: a def
# may only call the defs above it.

def decide.parked(fallback: Nat, until: Maybe<&2, Nat>) -> Decision:
  match until:
    # 3. A request whose login and model are parked until a time after
    #    `now` is diverted to its pool's fallback pool, with that pool
    #    and the reset.
    case Some{reset}:
      Divert{fallback, reset}
    # 4. Any other request is kept.
    case None{}:
      Keep{}

def decide.logged_in(fallback: Maybe<&2, Nat>, until: Maybe<&2, Nat>) -> Decision:
  match fallback:
    # 2. A request whose pool has no fallback pool is kept.
    case None{}:
      Keep{}
    case Some{f}:
      decide.parked(f, until)

def decide(policy: List<&2, Fallback>, parked: List<&2, Refusal>, request: Request, +now: Nat) -> Decision:
  match request:
    # 1. A request without a login is kept.
    case Request{pool, None{}, model}:
      Keep{}
    case Request{+pool, Some{+login}, +model}:
      decide.logged_in(fallback_of(policy, pool), parkedUntil(parked, login, model, now))
