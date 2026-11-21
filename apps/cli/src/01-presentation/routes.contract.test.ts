import * as Harness from "@cota/hub/harness";
import { expect, layer } from "@effect/vitest";
import { Effect, Layer, Redacted } from "effect";
import { Hub } from "#02-application/interfaces/hub.ts";
import * as HttpHub from "#04-infrastructure/http-hub.ts";
import {
  cota,
  joined,
  keyedKey,
  onAMachine,
  routesOf,
  subscriptionKey,
} from "#05-tests/machine.ts";

const owner = { COTA_OWNER_PASSWORD: Harness.secrets.ownerPassword };

/**
 * The hub over HTTP, keeping each sign-in it gives, and, when asked, storing
 * the routes it reads once more before it answers, as if the owner changed
 * them in Settings while `cota` held them.
 */
const watchedHub = (changeBetween: boolean) => {
  const signIns: Array<string> = [];
  const hub = Layer.effect(
    Hub,
    Effect.gen(function* () {
      const real = yield* Hub;
      return Hub.of({
        ...real,
        signIn: (address, password) =>
          real
            .signIn(address, password)
            .pipe(
              Effect.tap((signIn) =>
                Effect.sync(() => signIns.push(Redacted.value(signIn))),
              ),
            ),
        routes: (address, signIn, client) =>
          real
            .routes(address, signIn, client)
            .pipe(
              Effect.tap((list) =>
                changeBetween
                  ? real
                      .changeRoutes(
                        address,
                        signIn,
                        client,
                        list.revision,
                        list,
                      )
                      .pipe(Effect.orDie)
                  : Effect.void,
              ),
            ),
      });
    }),
  ).pipe(Layer.provide(HttpHub.layer));
  return { hub, signIns };
};

/** Whether each sign-in given still opens the owner's API: none should, once `cota` has ended. */
const stillSignedIn = (signIns: ReadonlyArray<string>) =>
  Effect.forEach(signIns, (signIn) =>
    Effect.map(
      Harness.send("/api/routes", {
        headers: { cookie: `cota_sign_in=${signIn}` },
      }),
      (response) => response.status !== 401,
    ),
  );

interface Stored {
  readonly client: string;
  readonly revision: number;
  readonly routes: ReadonlyArray<{
    readonly position: number;
    readonly pattern: string;
    readonly pool: string;
  }>;
  readonly defaultPool: { readonly pool: string } | null;
}

/** The routes of claude-code as the hub keeps them, read by the owner. */
const storedRoutes = Effect.gen(function* () {
  const listed = yield* Harness.send("/api/routes", {
    headers: yield* Harness.signIn(),
  });
  const { clients }: { readonly clients: ReadonlyArray<Stored> } = JSON.parse(
    yield* Harness.textOf(listed),
  );
  const stored = clients.find(({ client }) => client === "claude-code");
  if (stored === undefined)
    return yield* Effect.die("no routes of claude-code");
  return stored;
});

layer(Harness.layer())("routes from the CLI against a whole hub", (it) => {
  it.effect(
    "shows a client's routes signed in with COTA_OWNER_PASSWORD, or the password typed at a prompt, and signs out",
    () =>
      onAMachine((on) =>
        Effect.gen(function* () {
          yield* joined(on, [subscriptionKey, keyedKey]);
          yield* routesOf(
            "claude-code",
            [
              { pattern: "acme/*", pool: "claude" },
              { pattern: "my project", pool: "solo" },
            ],
            "personal",
          );
          const { hub, signIns } = watchedHub(false);
          expect(
            yield* cota(on, ["routes", "show", "claude"], {
              variables: owner,
              hub,
            }),
          ).toEqual({
            status: 0,
            out: "acme/* claude\nmy project solo\n* personal\n",
            err: "",
          });
          expect(
            yield* cota(on, ["routes", "show", "claude"], {
              typed: [Harness.secrets.ownerPassword],
              hub,
            }),
          ).toEqual({
            status: 0,
            out: "acme/* claude\nmy project solo\n* personal\n",
            err: "",
          });
          expect(signIns).toHaveLength(2);
          expect(yield* stillSignedIn(signIns)).toEqual([false, false]);
        }),
      ),
  );

  it.effect(
    "sets a client's routes from standard input, from the revision it read, prints what was stored, and signs out",
    () =>
      onAMachine((on) =>
        Effect.gen(function* () {
          yield* joined(on, [subscriptionKey, keyedKey]);
          yield* routesOf("claude-code", [], "personal");
          const before = yield* storedRoutes;
          const { hub, signIns } = watchedHub(false);
          const set = yield* cota(on, ["routes", "set", "claude"], {
            input: ["acme/* claude", "keyed/* console", "* solo"],
            variables: owner,
            hub,
          });
          const after = yield* storedRoutes;
          expect(set).toEqual({
            status: 0,
            out: "acme/* claude\nkeyed/* console\n* solo\n",
            err: `cota: stored the routes of claude-code, revision ${after.revision}.\n`,
          });
          expect(after).toMatchObject({
            revision: before.revision + 1,
            routes: [
              { position: 1, pattern: "acme/*", pool: "claude" },
              { position: 2, pattern: "keyed/*", pool: "console" },
            ],
            defaultPool: { pool: "solo" },
          });
          expect(yield* stillSignedIn(signIns)).toEqual([false]);
        }),
      ),
  );

  it.effect(
    "stores nothing for routes the hub refuses, printing each refusal a row, nor for routes changed after cota read them, nor for routes that do not read, and signs out each time",
    () =>
      onAMachine((on) =>
        Effect.gen(function* () {
          yield* joined(on, [subscriptionKey, keyedKey]);
          yield* routesOf(
            "claude-code",
            [{ pattern: "acme/*", pool: "claude" }],
            "personal",
          );
          const before = yield* storedRoutes;
          const refusedHub = watchedHub(false);
          const refused = yield* cota(on, ["routes", "set", "claude"], {
            input: ["acme/* codex", "acme/* claude", "x/* nowhere"],
            variables: owner,
            hub: refusedHub.hub,
          });
          expect(refused.status).toBe(1);
          expect(refused.out).toBe("");
          expect(refused.err).toBe(
            [
              "cota: the routes of claude-code were not stored:\n",
              "cota: route 1, acme/* codex: the pool does not speak anthropic-messages\n",
              "cota: route 2, acme/* claude: an earlier route has the same pattern\n",
              "cota: route 3, x/* nowhere: the hub has no such pool\n",
            ].join(""),
          );

          const unread = yield* cota(on, ["routes", "set", "claude"], {
            input: ["acme/*"],
            variables: owner,
            hub: refusedHub.hub,
          });
          expect(unread).toEqual({
            status: 1,
            out: "",
            err: 'cota: the routes given do not read: line 1 is not a pattern and a pool: "acme/*"; give them as cota routes show prints them\n',
          });

          const changedHub = watchedHub(true);
          expect(
            yield* cota(on, ["routes", "set", "claude"], {
              input: ["* solo"],
              variables: owner,
              hub: changedHub.hub,
            }),
          ).toEqual({
            status: 1,
            out: "",
            err: "cota: the routes of claude-code changed after cota read them, and were not stored; read them again with cota routes show claude\n",
          });
          const after = yield* storedRoutes;
          expect(after.revision).toBe(before.revision + 1);
          expect(after).toMatchObject({ defaultPool: { pool: "personal" } });
          const signIns = [...refusedHub.signIns, ...changedHub.signIns];
          expect(signIns).toHaveLength(3);
          expect(yield* stillSignedIn(signIns)).toEqual([false, false, false]);
        }),
      ),
  );

  it.effect(
    "stops on a wrong password, on no password where none can be asked, and on a machine that has not joined, never printing the password",
    () =>
      onAMachine((on) =>
        Effect.gen(function* () {
          expect(
            yield* cota(on, ["routes", "show", "codex"], { variables: owner }),
          ).toEqual({
            status: 1,
            out: "",
            err: "cota: this machine has not joined a hub. Join one: cota join <hub>\n",
          });
          yield* joined(on, [subscriptionKey]);
          expect(
            yield* Harness.withTheClockRunning(
              cota(on, ["routes", "show", "codex"], {
                variables: { COTA_OWNER_PASSWORD: "not-the-owner-password" },
              }),
            ),
          ).toEqual({
            status: 1,
            out: "",
            err: "cota: the owner password is wrong\n",
          });
          expect(yield* cota(on, ["routes", "set", "codex"])).toEqual({
            status: 1,
            out: "",
            err: "cota: COTA_OWNER_PASSWORD is not set, and standard input is not a terminal to ask for the owner password on\n",
          });
        }),
      ),
  );
});
