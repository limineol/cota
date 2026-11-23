---
status: active
scope: apps/hub
owner: limineol
last_verified: 2026-11-23
review_by: 2027-02-23
supersedes: []
code:
  - apps/hub/src/modules/admission/03-domain
  - apps/hub/src/modules/admission/02-application
  - apps/hub/src/modules/admission/04-infrastructure
  - apps/hub/src/modules/admission/01-presentation
---

# Admission

Before the hub forwards anything, it decides whether the request may use the pool it names. This spec covers that decision, and who a hub key presented to the hub's API is. It is the admission module, `apps/hub/src/modules/admission`: the relay asks its `AdmitRequest` query (`02-application/queries/admit-request.query.ts`), which finds the hub key a request presents and asks the `Admission` service (`03-domain/admission.ts`) to decide, and the relay applies the answer (`docs/specs/relay/spec.md`). The API asks its `IdentifyHubKey` query (`02-application/queries/identify-hub-key.query.ts`), and answers `GET /api/machine` with its `ReadMachine` query (`02-application/queries/read-machine.query.ts`). ADR-0012 gives the reasons for the reader scope.

Admission is what keeps the kinds of pool apart, keeps reader keys out of them, and keeps every hub key out of an observed pool. A subscription hub key that Claude Code carries sits in the environment of every command Claude Code runs, so it must be worthless for spending a key the hub holds: without the client's own login it spends nothing. A keyed hub key spends the keys the hub holds, so the owner gives it only to a client they trust with them. A reader key reads the request log through the API and spends nothing.

## Values

- **Admission policy**: the hub keys, each with a name and a scope (`scope = "subscription"`, `"keyed"` or `"reader"` in the configuration), and the pools, each with its kind. The kind comes from the pool's configuration, not its protocol: a pool declared `observed = true` is observed (ADR-0029), a pool that holds a key, or that speaks `openai-chat`, is keyed, and any other is a subscription pool (ADR-0009). The service is built from it: `Admission.layer(policy)`. A hub key is known to the policy by its digest; `AdmitRequest` computes the digest of what a request presents.
- **Scope** takes three values, `subscription`, `keyed` and `reader`; **kind** takes three, `subscription`, `keyed` and `observed`. A pool is never of kind `reader`, and no hub key is of scope `observed`, so a reader key's scope is no pool's kind and an observed pool is no hub key's scope: `decide` rejects every request to an observed pool as `WrongScope` by rule 4, and the relay is never asked to forward to one (`docs/specs/reported-requests/spec.md`, L15).
- **Request**, as the decision sees it: the digest of the hub key it presents, if it presents one, and the pool it names.

## The presented hub key

`AdmitRequest` is given the pool a request names and three values its headers carry: `x-cota-key`, the bearer token of `authorization`, and `x-api-key` (`03-domain/hub-key.ts`). The hub key it presents is its `x-cota-key`, trimmed, when that is not empty; otherwise, to a keyed pool only, its bearer token, else its `x-api-key`, trimmed, when that is not empty. A pool the policy does not know is read as a subscription pool, so only `x-cota-key` counts for it, as for an observed pool. The digest of the presented key is compared in constant time with every digest the policy knows, through the port `HubKeyHasher` (`02-application/interfaces/hub-key-hasher.ts`), whose adapter takes SHA-256 digests (`04-infrastructure/sha256-hub-key-hasher.ts`, ADR-0009), and a key that matches none is decided by its own digest, which the policy does not know.

## Deciding

`decide(request)` answers **admitted** or **rejected**. The first rule that applies wins:

1. A request that presents no hub key is rejected: `NoHubKey`.
2. A request whose hub key the policy does not know is rejected: `UnknownHubKey`.
3. A request that names a pool the policy does not know is rejected: `UnknownPool`.
4. A request whose hub key's scope is not the pool's kind is rejected: `WrongScope`.
5. Any other request is admitted. The answer carries the hub key's name and the pool's kind.

Rules 1 and 2 come before rule 3 on purpose: someone without a hub key learns nothing about which pools exist.

A reader key is a hub key the policy knows, so rules 1 and 2 pass, and rule 4 rejects it as `WrongScope` at every pool the policy knows; rule 3 answers `UnknownPool` first at one it does not. The relay answers 403 `cota_hub_key_scope`, as it does a subscription key at a keyed pool, and 404 `cota_unknown_pool`.

## Identifying a hub key

`IdentifyHubKey` answers who the hub key a request to the hub's API presents is: its name and scope, or nothing. The presented key is `x-cota-key`, trimmed, when not empty, else the bearer token of `authorization` (`presentedToApi` in `03-domain/hub-key.ts`); `x-api-key` is never read. Its digest is compared in constant time with every digest the policy knows, through `HubKeyHasher`, as `AdmitRequest` does, and a key that matches none, or a request that presents none, is answered with nothing. A hub key of any scope is identified; what the API lets each scope do is `docs/specs/sign-in/spec.md`.

## The machine

`ReadMachine` answers a caller of the API, the owner or a hub key `CallerMiddleware` identified, what it is and the pools it opens: what a machine needs to join the hub and configure its clients (`docs/specs/cli/spec.md`). The endpoint, `GET /api/machine`, and its fields are `docs/specs/api/spec.md`, Machine.

- **What it is**: the hub key's name and scope, or none for the owner.
- **The pools it opens**: for the owner every pool of the configuration, an observed one among them with no protocol; for a hub key the pools whose kind is its scope, by the rule `decide` applies (`opens` in `03-domain/admission.ts`), so a reader key opens none and a subscription key never learns a keyed pool, its models or its prices. They are in order of id, each with its id, kind, protocol, provider and the owner's display name for it, which it reads through the display-names module's `ListDisplayNames`.
- **A keyed pool's models**: the models of its price list and of its own prices (ADR-0009), which it reads through the request log's `ListPoolModels` (`docs/specs/protocols/spec.md`, Prices), in order of id. Each has its name (the owner's display name, else the built-in one, else its id), its context and output limits and image input from the list (none for a model only the pool's own prices name), and its price: the pool's own when it has one, else the list's, every missing cache rate filled in as a cost fills it in (`docs/specs/cost/spec.md`, rule 4). A subscription pool has no models: its client lists its own. An observed pool has none either.
- **The observed pools**: to every caller, the owner and every hub key, a reader key among them, the observed pools in order of id, each with its id, provider and the owner's display name for it, so that a machine checks the pool it reports to (ADR-0029).

Its answer has no field for a hub key's secret, a held key or a kept login, so none can reach a machine through it.

## Laws

| Id | Law | Held by |
| --- | --- | --- |
| A1 | **No key, no entry.** A request that presents no hub key, or one the policy does not know, is rejected, whatever pool it names. | property |
| A2 | **Scope.** A request is admitted only to a pool whose kind is its hub key's scope. | property |
| A3 | **Nothing before the key.** A request without a known hub key gets the same answer whether or not the pool it names exists. | property |
| A4 | **Admitted as configured.** An admitted request's answer carries the kind the policy gives its pool and the name the policy gives its hub key. | property |
| A5 | **A reader key opens no pool.** A request that presents a reader key is rejected, whatever pool it names. | property |
| A6 | **Identified as configured.** `IdentifyHubKey` gives the name and scope the policy gives the presented key's digest, and nothing for a key the policy does not know or a request that presents none. | property |
| A7 | **A machine learns only what it opens.** The pools answered are exactly those whose kind is the caller's scope, in order of id: every pool for the owner and none for a reader key. | property |
| A8 | **The pool's own price wins.** A keyed pool's models are those of its price list and its own prices, with the list's limits and image input, each at the pool's own price when it has one, else the list's, every missing cache rate filled in; a subscription pool has none. | property |

A2 is the security property: a subscription hub key, which every command a client runs can read, never opens a pool the hub pays for with a key it holds. A2 already implies A5, since no pool's kind is `reader`; A5 is stated so that a mutant letting `reader` match a kind fails a law of its own. The generators of A1 to A5 draw hub keys from all three scopes.

The decision has no state and no time, so there is no history to prove anything over. The laws are held by property tests over generated policies and requests, and by mutants. A1 to A5 test the `Admission` service (`03-domain/admission.laws.test.ts`); A6 tests `IdentifyHubKey` with the SHA-256 hasher, over generated policies and requests that present a known key, an unknown one, a blank or padded `x-cota-key`, a bearer token or nothing (`02-application/queries/identify-hub-key.query.laws.test.ts`). A7 and A8 test `ReadMachine` over the shipped price lists (`02-application/queries/read-machine.query.laws.test.ts`), with generated configurations of up to six pools of any kind, each naming a shipped list or none and up to four own prices, some with cache rates and tiers missing, for models the lists have with and without limits, models they lack and `constructor`, and with the owner and hub keys of every scope as callers. A7 is the security property of the answer, as A2 is of a request: the rule both use is `opens`, so a mutant that lets a scope open another kind fails both. The contract test (`01-presentation/machine.contract.test.ts`) asks a whole hub as each kind of caller, with literal answers, and finds no hub key, held key or kept login in any of them.

## Not built, on purpose

- **Secrets in the decision.** `decide` sees only digests. Digesting what a request presents, and comparing it in constant time, are `AdmitRequest`'s, through `HubKeyHasher`.
- **Per-pool or per-machine keys.** A hub key opens every pool of its scope. A key for one machine, or one pool, is a later rule and would be a new law.
- **The login.** Admission does not look at whether a subscription request carries a login. A request without one is forwarded, and the provider's own refusal tells the client to log in.
