---
status: accepted
scope: apps/hub
owner: limineol
last_verified: 2026-11-19
review_by: 2027-02-18
supersedes: []
code:
  - apps/hub/src/modules
  - apps/hub/src/shared
  - apps/hub/src/lib
  - apps/hub/src/config
  - apps/hub/src/hub.ts
  - apps/hub/src/main.ts
  - apps/hub/src/restore-archive.ts
  - apps/hub/src/import.ts
  - apps/hub/package.json
  - tooling/boundaries.ts
---

# ADR-0010: The hub is modules in numbered layers

## Context

Milestone 1 grew `apps/hub/src` as twenty-three sibling folders and `main.ts` (`relay`, `ledger`, `writer`, `tables`, `clickhouse`, `protocol`, `recorder`, `scrubber`, `tee`, `harness` and the rest), beside a separate `packages/domain` that held admission, fallback, cost and quota windows. Nothing in a path said what a file was: a use case, a port, an adapter, a rule or test support. Persisting the request log was spread over three folders (`writer`, `tables`, `clickhouse`), so changing the store meant reading all of them, and the rules of a concept lived in another package from the code that used them. A reader had to know the code to find their way in it.

## Decision

```text
apps/hub/src/
├── main.ts                  reads the configuration and launches the hub
├── restore-archive.ts       reads [clickhouse] and restores the request log's archive (ADR-0018)
├── import.ts                reads an import file and imports the prototype's log (ADR-0025)
├── hub.ts                   assembles the modules into one server
├── api.ts                   defines the API from each module's groups (ADR-0011)
├── config/                  decodes cota.toml into what each module's layer takes
├── modules/<module>/
│   ├── 01-presentation/     what the world calls: routes, scripts, the hub's error bodies
│   ├── 02-application/
│   │   ├── commands/        one use case that acts, per file
│   │   ├── queries/         one use case that reads, per file
│   │   └── interfaces/      the ports the use cases need
│   ├── 03-domain/           the rules: Schemas, values and services, with no IO
│   ├── 04-infrastructure/   the adapters that implement the ports
│   ├── 05-tests/            the module's test support: fakes, scratch databases
│   └── module.ts            the module's layer: its commands and queries over the adapters it chooses
├── shared/
│   ├── 01-presentation/     what every API group declares: the caller and JSON body middleware, the shared problems
│   ├── 03-domain/           the words two or more modules speak
│   ├── 04-infrastructure/   shutdown, and the hub store each module's steps make its tables in
│   └── 05-tests/            the whole-hub harness, the fake provider, the replay test and its exchanges
└── lib/                     code that knows nothing of Cota: tee, copy
```

The modules are `admission` (which hub key may use which pool), `relay` (forwards a request to its pool's provider), `request-log` (records every finished request, and since milestone 2a reads the log back: traffic, sessions, search and SQL), `quota` (each pool's quota windows, where they come from, the quota readers and the quota logins, since milestone 2b), `recording` (records exchanges, in development only), and, since milestone 2a, `sign-in` (the owner's sign-ins, and who may call the API) and `display-names` (the owner's names for pools, models, clients, machines and projects), and, since milestone 3, `dashboard` (serves the dashboard's built files, ADR-0019). A module has only the layers it has content for.

**Layers.** `02-application` holds the use cases and the ports, in `commands/`, `queries/` and `interfaces/`, and nothing else: a value or rule they share is the module's domain, in `03-domain`, named for its concept. The relay's `Protocol` port (`interfaces/protocol.ts`) speaks in the values of its domain (`client-request.ts`, `description.ts`, `reading.ts`, `refusal.ts`), and its `PlanCredential` query gives a `Plan` from `03-domain/credential.ts`. A stateful in-process service that several use cases share lives in the module's `03-domain` too, as a `Context.Service` with a `layer`, when it does no IO itself and takes its IO as effects its callers give it or through ports they hold: the relay's `Fallback`; the quota module's `Readings`, which runs the read `ReadPools` gives it, one at a time per pool, and keeps its outcome; and its `Refreshes`, which runs the refresh `RefreshQuotaLogin` gives it, one at a time per quota login, and holds in memory the refreshed logins the hub store did not take, for that command to write again through its port. `02-application` has no place for such a service: it holds only use cases and ports. A port is a `Context.Service` in the module's own terms: `RequestsRepository` (`modules/request-log/02-application/interfaces/requests.repository.ts`) speaks in requests, costs and items, never in rows. An adapter is a `Layer` of that service: `04-infrastructure/persistence/clickhouse/clickhouse-requests.repository.ts`, with its client, schema and mappers in the same folder.

**Naming.** One command or query per file, `<verb-noun>.command.ts` or `<noun>.query.ts`, exporting one `Context.Service` named for it (`RecordRequest`, `RebuildConversation`, `AdmitRequest`, `ForwardRequest`, `PlanCredential`, `RecordExchange`) with an `execute`, and its `layer`, which takes the ports as services. Other suffixes say what a file is: `.entity.ts`, `.repository.ts`, `.mapper.ts`, `.routes.ts`. A test sits beside its file: `.test.ts`, `.laws.test.ts`, `.clickhouse.test.ts`.

**Imports.** `bun run boundaries` (`tooling/boundaries.ts`) fails on each of these:

- A file in a module is its `module.ts` or is under one of the five layer folders, and `shared` holds only layer folders. Tests aside, no file escapes the rules by sitting elsewhere.
- A file in `02-application`, a module's or `shared`'s, is under its `commands/`, `queries/` or `interfaces/`. A test sits beside the file it tests.
- Within a module, and within `shared`: `01-presentation` imports `01`, `02` and `03`; `02-application` imports `02` and `03`; `03-domain` imports `03`; `04-infrastructure` imports `04`, `02` and `03`. None imports `module.ts` or `05-tests`.
- Another module is reached only through its `02-application/commands/` and `02-application/queries/`. A type two modules need moves to `shared/03-domain`.
- A module may import `shared`, except `shared/05-tests`. `shared` imports no module. `lib` imports only `lib` and outside packages.
- Nothing in `modules`, `shared` or `lib` imports `config/`, `hub.ts`, `main.ts`, `api.ts`, `restore-archive.ts` or `import.ts`.
- No import climbs out of its folder with `..`. A file reaches another folder by its path under `src`, `#modules/request-log/03-domain/cost.ts` (the `"#*": "./src/*"` entry of `apps/hub/package.json`'s `imports`; beside it, `"#package.json"` lets a quota adapter read the hub's `version` for its user agent, ADR-0016, since no import climbs out of `src`), and its own folder with `./`.
- Every `03-domain` folder, a module's or `shared`'s, has no IO: from `effect` it imports only the in-process modules the tool lists (ADR-0003), and no other outside package. Its tests are exempt.
- Nothing in `02-application` or `03-domain` imports `effect/http`, not even a type: HTTP's types stay in `01-presentation` and `04-infrastructure`, and a value a module needs from them is its own, such as the relay's `Method` (`03-domain/method.ts`). Tests are exempt.
- `proofs` imports the hub only through the package's `exports` (`@cota/hub/fallback`, `@cota/hub/ids`).

Tests (`*.test.ts`), every `05-tests` folder, each `module.ts`, and the composition root (`config/`, `hub.ts`, `main.ts`, `api.ts`, the API's definition, ADR-0011, `restore-archive.ts`, the restore's script, ADR-0018, and `import.ts`, the import's, ADR-0025) are exempt from the layer and module rules.

**The shared domain** holds what two or more modules speak: ids, the pool, the request, usage, price, the conversation, the client and the protocol's name. A rule one module uses stays in that module's `03-domain`, and a type leaves `shared` when only one module still uses it.

**`lib`** holds code that would work in any program: the tee that copies a stream to readers without slowing it, and the readers of a copy. It takes what it needs as arguments.

**The composition root.** `config/` decodes the configuration into each module's options, each `module.ts` builds its module's layer, `hub.ts` joins the modules into the server, and `main.ts` provides the request log and the recorder and launches it. `restore-archive.ts` is the composition root of the second program, `bun run archive:restore` (ADR-0018): it joins the restore's command to the ClickHouse and file-system adapters over the configuration's `[clickhouse]`, and runs it. A module's `module.ts` provides everything the module owns: its commands and queries, the adapters of its ports, and the services and work no other module uses. The relay's provides `Fallback` and its once-a-minute `forget`, the `Protocols` registry, `PlanCredential`, `ForwardRequest`, the HTTP provider and the HTTP client it sends with. `hub.ts` and `main.ts` hold only what is shared across modules: the server, its shutdown, the configuration, the API, and the modules one module asks of another. `hub.ts` builds the API from each module's groups with the middleware they declare (sign-in's callers, the JSON body limit, problem details) over sign-in and display-names, gives the relay admission, and lists every module's hub store steps; `main.ts` provides the request log, the recorder and the hub store with those steps. Layers are joined nowhere else (ADR-0003).

## Why Effect services, not classes

The codebase this layout was taken from writes a use case as a class whose ports are `private readonly` constructor parameters, wired by hand in `module.ts`. Cota keeps Effect services. A layer that yields its ports (`yield* RequestsRepository`) is the same dependency inversion: its type, `Layer<RecordRequest, never, RequestsRepository | Prices>`, lists the ports as a constructor would, the type check refuses a hub in which one is not provided, and `module.ts` chooses the adapter with `Layer.provide`. A layer also owns what the service holds: `RecordRequest`'s queue and writer are released with its scope, which a constructor would need a separate shutdown for. And it keeps one way of writing logic everywhere (ADR-0003).

## What this changes

It amends ADR-0002, ADR-0003 and ADR-0004, which were written when the domain was its own package, `packages/domain`. That package is gone: each rule is its module's `03-domain`, and `proofs` reaches them through `@cota/hub`'s exports. `tooling/boundaries.ts` now holds the layer and module rules beside the table of packages. The domain now inherits `apps/hub`'s list of allowed unstable APIs, so what keeps it off `effect/http` is the boundaries tool's in-process list, not a shorter list of its own.

## Consequences

- A path says what a file is, and the ClickHouse folder is the whole of the request log's persistence. A second store is one folder beside it and the line of `module.ts` that provides it, though its connection must also come from `config/`.
- Paths are long (`modules/request-log/04-infrastructure/persistence/clickhouse/mappers/request.mapper.ts`). That is the price of saying what a file is.
- The shared domain is where a type goes when two modules need it, so it can become a dumping ground. The tool keeps it free of IO and of modules, but does not count who uses a file; review holds the two-module rule.
- The exempt files can import anything, because they must. `module.ts` chooses its module's adapters, which only it may name. The composition root decodes and wires every module, so it reads their options, and their errors to print them. Tests drive a module through its real neighbours and build whole hubs. Each of these is read in review with that in mind.
- The tool checks what it states and no more. A module may reach another's command or query from any of its layers, and a module's layer may import any layer of `shared` but its tests.
