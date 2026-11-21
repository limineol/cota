import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "@effect/vitest";
import {
  Arbitrary,
  DateTime,
  Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  Redacted,
  Result,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";
import { ChangeOwnerPassword } from "#modules/sign-in/02-application/commands/change-owner-password.command.ts";
import { ForgetOwnerPassword } from "#modules/sign-in/02-application/commands/forget-owner-password.command.ts";
import { MakePasskey } from "#modules/sign-in/02-application/commands/make-passkey.command.ts";
import { PreparePasskey } from "#modules/sign-in/02-application/commands/prepare-passkey.command.ts";
import { PreparePasskeySignIn } from "#modules/sign-in/02-application/commands/prepare-passkey-sign-in.command.ts";
import { RemovePasskey } from "#modules/sign-in/02-application/commands/remove-passkey.command.ts";
import { SetUpHub } from "#modules/sign-in/02-application/commands/set-up-hub.command.ts";
import { SignInOwner } from "#modules/sign-in/02-application/commands/sign-in-owner.command.ts";
import { SignInWithPasskey } from "#modules/sign-in/02-application/commands/sign-in-with-passkey.command.ts";
import { Passkeys } from "#modules/sign-in/02-application/interfaces/passkeys.repository.ts";
import { SignIns } from "#modules/sign-in/02-application/interfaces/sign-ins.repository.ts";
import { StoredPasswords } from "#modules/sign-in/02-application/interfaces/stored-passwords.repository.ts";
import { ReadWaysIn } from "#modules/sign-in/02-application/queries/read-ways-in.query.ts";
import type { SignInResponse } from "#modules/sign-in/03-domain/ceremony.ts";
import * as Challenges from "#modules/sign-in/03-domain/challenges.ts";
import * as RelyingParty from "#modules/sign-in/03-domain/relying-party.ts";
import * as SqlitePasskeys from "#modules/sign-in/04-infrastructure/persistence/sqlite/sqlite-passkeys.repository.ts";
import * as SqliteSignIns from "#modules/sign-in/04-infrastructure/persistence/sqlite/sqlite-sign-ins.repository.ts";
import * as SqliteStoredPasswords from "#modules/sign-in/04-infrastructure/persistence/sqlite/sqlite-stored-passwords.repository.ts";
import * as SimpleWebAuthn from "#modules/sign-in/04-infrastructure/simple-web-authn.ts";
import * as FastPasswordHasher from "#modules/sign-in/05-tests/fakes/fast-password-hasher.ts";
import * as InMemorySignIns from "#modules/sign-in/05-tests/fakes/in-memory-sign-ins.repository.ts";
import * as InMemoryWaysIn from "#modules/sign-in/05-tests/fakes/in-memory-ways-in.ts";
import * as KnownSetupCodes from "#modules/sign-in/05-tests/fakes/known-setup-codes.ts";
import * as Authenticator from "#modules/sign-in/05-tests/software-authenticator.ts";
import * as SignInModule from "#modules/sign-in/module.ts";
import { PasskeyId, type SignInId } from "#shared/03-domain/ids.ts";
import * as HubStore from "#shared/04-infrastructure/hub-store/hub-store.ts";

const configuredPassword = "owner-password-0c3e";
const userAgent = "Mozilla/5.0 Firefox/150.0";

const overPorts = (configured: boolean) =>
  SignInModule.overPorts({
    password: configured
      ? Option.some(Redacted.make(configuredPassword))
      : Option.none(),
  }).pipe(
    Layer.provide([
      FastPasswordHasher.layer,
      KnownSetupCodes.layer,
      SimpleWebAuthn.layer,
    ]),
  );

const inMemory = (configured: boolean) =>
  overPorts(configured).pipe(
    Layer.provideMerge(InMemoryWaysIn.layer()),
    Layer.provideMerge(InMemorySignIns.layer),
  );

const overSqlite = (configured: boolean, path: string) =>
  overPorts(configured).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        SqliteStoredPasswords.layer,
        SqlitePasskeys.layer,
        SqliteSignIns.layer,
      ).pipe(
        Layer.provide(HubStore.layer({ path, steps: SignInModule.steps })),
        Layer.orDie,
      ),
    ),
  );

const scratch = mkdtempSync(join(tmpdir(), "cota-passkeys-laws-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let stores = 0;
const freshPath = () => {
  stores += 1;
  return join(scratch, `${stores}.sqlite`);
};

type Module =
  | PreparePasskey
  | MakePasskey
  | PreparePasskeySignIn
  | SignInWithPasskey
  | RemovePasskey
  | ForgetOwnerPassword
  | ChangeOwnerPassword
  | SetUpHub
  | SignInOwner
  | ReadWaysIn
  | Passkeys
  | StoredPasswords
  | SignIns;

/** Runs `run` against the module over the in-memory store, and again over a SQLite store in a new file. */
const inEachStore = <A>(
  configured: boolean,
  run: Effect.Effect<A, never, Module>,
) =>
  Effect.all([
    run.pipe(Effect.provide(inMemory(configured))),
    run.pipe(Effect.provide(overSqlite(configured, freshPath()))),
  ]);

/** Runs an effect while the clock moves a tenth of a second at a time, until it is answered. */
const answered = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect);
    yield* Effect.yieldNow;
    while (fiber.pollUnsafe() === undefined) {
      yield* TestClock.adjust("100 millis");
      yield* Effect.yieldNow;
    }
    return yield* Fiber.join(fiber);
  });

interface Answer {
  readonly tag: string;
  readonly afterMillis: number;
}

const answerOf = <A, E extends { readonly _tag: string }, R>(
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const began = DateTime.toEpochMillis(yield* DateTime.now);
    const result = yield* Effect.result(effect);
    const answer: Answer = {
      tag: Result.isSuccess(result) ? "Success" : result.failure._tag,
      afterMillis: DateTime.toEpochMillis(yield* DateTime.now) - began,
    };
    return answer;
  });

/** Where the tests' passkeys live: a host name over https, and localhost over http. */
const sites = {
  cota: { origin: "https://cota.example", rpId: "cota.example" },
  local: { origin: "http://localhost:4317", rpId: "localhost" },
};
type Site = (typeof sites)[keyof typeof sites];

const lifetimeMillis = Duration.toMillis(Challenges.lifetime);

const randomChallenge = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");

/** Asks for creation options at the site and answers them with the key, as a browser would. */
const makeWith = (key: Authenticator.Key, site: Site, counter: number) =>
  Effect.gen(function* () {
    const preparePasskey = yield* PreparePasskey;
    const makePasskey = yield* MakePasskey;
    const options = yield* Effect.orDie(preparePasskey.execute(site.origin));
    return yield* makePasskey.execute({
      response: Authenticator.create(key, options.challenge, {
        ...site,
        userVerified: true,
        counter,
      }),
      userAgent,
    });
  });

/** Signs in with the key at the site it was made at, with nothing wrong. */
const signInWith = (key: Authenticator.Key, site: Site) =>
  Effect.gen(function* () {
    const prepare = yield* PreparePasskeySignIn;
    const signIn = yield* SignInWithPasskey;
    const options = yield* Effect.orDie(prepare.execute(site.origin));
    const response = yield* Authenticator.get({
      credentialId: key.credentialId,
      signer: key,
      challenge: options.challenge,
      signing: { ...site, userVerified: true, counter: 0 },
    });
    return yield* answerOf(signIn.execute({ response, userAgent }));
  });

const Scheme = Schema.Literals(["https", "http", "ftp", "wss"]);

/** A host as an Origin may write it, and what it is: a host name, localhost, or an IP address in one of its writings. */
const hosts = [
  { writing: "cota.example", kind: "name" },
  { writing: "Hub.Example.ORG", kind: "name" },
  { writing: "xn--bcher-kva.example", kind: "name" },
  { writing: "a-1.b2.example", kind: "name" },
  { writing: "hub.localhost", kind: "name" },
  { writing: "localhost", kind: "localhost" },
  { writing: "LocalHost", kind: "localhost" },
  { writing: "127.0.0.1", kind: "address" },
  { writing: "192.168.1.20", kind: "address" },
  { writing: "2130706433", kind: "address" },
  { writing: "0x7f000001", kind: "address" },
  { writing: "0177.0.0.1", kind: "address" },
  { writing: "127.1", kind: "address" },
  { writing: "0x7f.1", kind: "address" },
  { writing: "[::1]", kind: "address" },
  { writing: "[2001:db8::7]", kind: "address" },
  { writing: "[::ffff:127.0.0.1]", kind: "address" },
] as const;

const Origin = Schema.Union([
  Schema.TaggedStruct("Origin", {
    scheme: Scheme,
    host: Schema.Int.check(
      Schema.isBetween({ minimum: 0, maximum: hosts.length - 1 }),
    ),
    port: Schema.Literals(["", ":443", ":80", ":8443", ":4317"]),
  }),
  Schema.TaggedStruct("Other", {
    origin: Schema.Literals(["null", "", "cota.example", "https://", "https:"]),
  }),
  Schema.TaggedStruct("Missing", {}),
]);
type Origin = typeof Origin.Type;

/** What the rule gives an origin, worked out from how it was made. */
const expectedOf = (origin: Origin) => {
  if (origin._tag !== "Origin") return null;
  const host = hosts[origin.host];
  if (host === undefined || host.kind === "address") return null;
  const web = origin.scheme === "https" || origin.scheme === "http";
  if (!web) return null;
  if (host.kind === "name" && origin.scheme !== "https") return null;
  const id = host.writing.toLowerCase();
  const defaultPort = origin.scheme === "https" ? ":443" : ":80";
  const port = origin.port === defaultPort ? "" : origin.port;
  return { id, origin: `${origin.scheme}://${id}${port}` };
};

const writingOf = (origin: Origin) => {
  switch (origin._tag) {
    case "Origin":
      return `${origin.scheme}://${hosts[origin.host]?.writing}${origin.port}`;
    case "Other":
      return origin.origin;
    case "Missing":
      return undefined;
  }
};

const Purpose = Schema.Literals(["make-passkey", "sign-in"]);
const relyingParties = [
  { id: sites.cota.rpId, origin: sites.cota.origin },
  { id: sites.local.rpId, origin: sites.local.origin },
] as const;

const ChallengeStep = Schema.Union([
  Schema.TaggedStruct("Issue", {
    purpose: Purpose,
    at: Schema.Literals([0, 1]),
    times: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 70 })),
  }),
  Schema.TaggedStruct("Take", {
    which: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 150 })),
  }),
  Schema.TaggedStruct("Wait", {
    millis: Schema.Literals([1, 1000, 60_000, lifetimeMillis - 1]),
  }),
  Schema.TaggedStruct("UntilExpiry", {
    which: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 150 })),
    offsetMillis: Schema.Literals([-1, 0, 1]),
  }),
]);
type ChallengeStep = typeof ChallengeStep.Type;

/**
 * Every sequence takes a challenge twice, takes the oldest of 65 issued at
 * once and the next, and takes two issued together a millisecond before and
 * at the instant they expire.
 */
const atTheEdges: ReadonlyArray<ChallengeStep> = [
  { _tag: "Issue", purpose: "sign-in", at: 0, times: 1 },
  { _tag: "Take", which: 0 },
  { _tag: "Take", which: 0 },
  { _tag: "Issue", purpose: "make-passkey", at: 1, times: 65 },
  { _tag: "Take", which: 1 },
  { _tag: "Take", which: 2 },
  { _tag: "UntilExpiry", which: 3, offsetMillis: -1 },
  { _tag: "Take", which: 3 },
  { _tag: "UntilExpiry", which: 4, offsetMillis: 0 },
  { _tag: "Take", which: 4 },
];

const challengeSequences = Arbitrary.array(Arbitrary.schema(ChallengeStep), {
  maxLength: 30,
}).pipe(Arbitrary.map((steps) => [...atTheEdges, ...steps]));

interface Given {
  readonly challenge: Challenges.Challenge;
  readonly purpose: Challenges.Purpose;
  readonly at: number;
  readonly relyingParty: 0 | 1;
  /** Where in the sequence of every issue and take it was issued. */
  readonly serial: number;
}

/**
 * Issues and takes challenges, and gives each take's answer beside the one
 * worked out from the history alone: a challenge is given back only when it
 * was issued, was not taken before, still lasts, and was not dropped, which it
 * is once 64 issued after it and not taken are outstanding with it.
 */
const issueAndTake = (sequence: ReadonlyArray<ChallengeStep>) =>
  Effect.gen(function* () {
    const challenges = yield* Challenges.Challenges;
    const given: Array<Given> = [];
    const takes: Array<{
      readonly challenge: string;
      readonly serial: number;
    }> = [];
    const answers: Array<unknown> = [];
    const expected: Array<unknown> = [];
    let serial = 0;
    const takenBefore = (challenge: string, before: number) =>
      takes.some(
        (take) => take.challenge === challenge && take.serial < before,
      );
    const dropped = (one: Given) =>
      given.some(
        (later) =>
          later.serial > one.serial &&
          given.filter(
            (other) =>
              other.serial > one.serial &&
              other.serial <= later.serial &&
              !takenBefore(other.challenge, later.serial),
          ).length >= Challenges.mostOutstanding,
      );
    for (const step of sequence) {
      switch (step._tag) {
        case "Issue":
          for (let time = 0; time < step.times; time++) {
            serial += 1;
            const challenge = Challenges.Challenge.make(`challenge-${serial}`);
            yield* challenges.issue(
              challenge,
              step.purpose,
              relyingParties[step.at],
            );
            given.push({
              challenge,
              purpose: step.purpose,
              at: DateTime.toEpochMillis(yield* DateTime.now),
              relyingParty: step.at,
              serial,
            });
          }
          break;
        case "Take": {
          serial += 1;
          const one = given[step.which];
          const challenge =
            one?.challenge ?? Challenges.Challenge.make("never-issued");
          const now = DateTime.toEpochMillis(yield* DateTime.now);
          const taken = yield* challenges.take(challenge);
          answers.push(
            Option.getOrNull(
              Option.map(taken, (issued) => ({
                purpose: issued.purpose,
                relyingParty: issued.relyingParty,
                at: DateTime.toEpochMillis(issued.at),
              })),
            ),
          );
          expected.push(
            one !== undefined &&
              !takenBefore(one.challenge, serial) &&
              one.at + lifetimeMillis > now &&
              !dropped(one)
              ? {
                  purpose: one.purpose,
                  relyingParty: relyingParties[one.relyingParty],
                  at: one.at,
                }
              : null,
          );
          takes.push({ challenge, serial });
          break;
        }
        case "Wait":
          yield* TestClock.adjust(Duration.millis(step.millis));
          break;
        case "UntilExpiry": {
          const one = given[step.which];
          if (one === undefined) break;
          const ahead =
            one.at +
            lifetimeMillis +
            step.offsetMillis -
            DateTime.toEpochMillis(yield* DateTime.now);
          if (ahead > 0) yield* TestClock.adjust(Duration.millis(ahead));
        }
      }
    }
    return { answers, expected };
  }).pipe(Effect.provide(Challenges.layer));

const Fault = Schema.Literals([
  "other-key",
  "unknown-credential",
  "other-site",
  "other-origin",
  "other-rp-id",
  "make-challenge",
  "unissued",
  "no-uv",
  "counter-behind",
  "removed",
]);
type Fault = typeof Fault.Type;

const CeremonyStep = Schema.Union([
  Schema.TaggedStruct("Ceremony", {
    passkey: Schema.Literals([0, 1, 2]),
    faults: Schema.Array(Fault).check(Schema.isMaxLength(2)),
    wait: Schema.Literals(["none", "almost", "expired"]),
  }),
  Schema.TaggedStruct("Replay", {}),
]);
type CeremonyStep = typeof CeremonyStep.Type;

/**
 * Every sequence signs in with a passkey that keeps no counter and replays
 * it, does the same with one that counts, then makes a ceremony with each
 * fault alone, and one answered as its challenge expires.
 */
const everyFault: ReadonlyArray<CeremonyStep> = [
  { _tag: "Ceremony", passkey: 0, faults: [], wait: "none" },
  { _tag: "Replay" },
  { _tag: "Ceremony", passkey: 1, faults: [], wait: "almost" },
  { _tag: "Replay" },
  ...Fault.literals.map(
    (fault): CeremonyStep => ({
      _tag: "Ceremony",
      passkey: fault === "counter-behind" ? 1 : 0,
      faults: [fault],
      wait: "none",
    }),
  ),
  { _tag: "Ceremony", passkey: 2, faults: [], wait: "expired" },
];

const ceremonies = Arbitrary.array(Arbitrary.schema(CeremonyStep), {
  maxLength: 20,
}).pipe(Arbitrary.map((steps) => [...everyFault, ...steps]));

interface Held {
  readonly key: Authenticator.Key;
  readonly site: Site;
  readonly counting: boolean;
  id: PasskeyId;
  counter: number;
}

/**
 * On a hub with three passkeys, one that keeps no counter and one that
 * counts at a host name, and one that keeps no counter on localhost, answers
 * sign-in ceremonies with the faults given, and gives each answer beside the
 * one expected: a sign-in exactly when nothing was wrong.
 */
const signInsWithFaults = (sequence: ReadonlyArray<CeremonyStep>) =>
  Effect.gen(function* () {
    const preparePasskey = yield* PreparePasskey;
    const prepareSignIn = yield* PreparePasskeySignIn;
    const signInWithPasskey = yield* SignInWithPasskey;
    const removePasskey = yield* RemovePasskey;
    const signIns = yield* SignIns;
    const make = (key: Authenticator.Key, site: Site, counter: number) =>
      Effect.map(Effect.orDie(makeWith(key, site, counter)), ({ id }) => id);
    const held: Array<Held> = [];
    for (const [site, counting] of [
      [sites.cota, false],
      [sites.cota, true],
      [sites.local, false],
    ] as const) {
      const key = yield* Authenticator.makeKey;
      const counter = counting ? 5 : 0;
      held.push({
        key,
        site,
        counting,
        counter,
        id: yield* make(key, site, counter),
      });
    }
    const answers: Array<string> = [];
    const expected: Array<string> = [];
    let lastResponse = Option.none<SignInResponse>();
    for (const step of sequence) {
      if (step._tag === "Replay") {
        if (Option.isNone(lastResponse)) continue;
        const answer = yield* answerOf(
          signInWithPasskey.execute({
            response: lastResponse.value,
            userAgent,
          }),
        );
        answers.push(answer.tag);
        expected.push("PasskeyRefused");
        continue;
      }
      const one = held[step.passkey];
      if (one === undefined) continue;
      const faults = new Set<Fault>(
        step.faults.filter(
          (fault) => fault !== "counter-behind" || one.counting,
        ),
      );
      const otherSite = one.site === sites.cota ? sites.local : sites.cota;
      const askedAt = faults.has("other-site") ? otherSite : one.site;
      const challenge = faults.has("unissued")
        ? randomChallenge()
        : faults.has("make-challenge")
          ? (yield* Effect.orDie(preparePasskey.execute(askedAt.origin)))
              .challenge
          : (yield* Effect.orDie(prepareSignIn.execute(askedAt.origin)))
              .challenge;
      if (faults.has("removed")) {
        yield* Effect.orDie(removePasskey.execute(one.id));
      }
      if (step.wait !== "none") {
        yield* TestClock.adjust(
          Duration.millis(lifetimeMillis - (step.wait === "almost" ? 1 : 0)),
        );
      }
      const stranger = yield* Authenticator.makeKey;
      const counter = one.counting
        ? faults.has("counter-behind")
          ? one.counter
          : one.counter + 1
        : 0;
      const response = yield* Authenticator.get({
        credentialId: faults.has("unknown-credential")
          ? stranger.credentialId
          : one.key.credentialId,
        signer:
          faults.has("other-key") || faults.has("unknown-credential")
            ? stranger
            : one.key,
        challenge,
        signing: {
          origin: faults.has("other-origin")
            ? "https://elsewhere.example"
            : askedAt.origin,
          rpId: faults.has("other-rp-id") ? "elsewhere.example" : askedAt.rpId,
          userVerified: !faults.has("no-uv"),
          counter,
        },
      });
      const answer = yield* answerOf(
        signInWithPasskey.execute({ response, userAgent }),
      );
      const right = faults.size === 0 && step.wait !== "expired";
      answers.push(answer.tag);
      expected.push(right ? "Success" : "PasskeyRefused");
      if (right) one.counter = counter;
      if (faults.has("removed")) {
        one.id = yield* make(one.key, one.site, one.counter);
      }
      lastResponse = Option.some(response);
    }
    const made = (yield* Effect.orDie(signIns.all)).length;
    return {
      answers,
      expected,
      made,
      succeeded: answers.filter((tag) => tag === "Success").length,
    };
  });

const PasskeyPick = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: 3 }),
);

const Command = Schema.Union([
  Schema.TaggedStruct("MakePasskey", {}),
  Schema.TaggedStruct("RemovePasskey", { which: PasskeyPick }),
  Schema.TaggedStruct("ForgetPassword", {}),
  Schema.TaggedStruct("SetPassword", { withCurrent: Schema.Boolean }),
]);
type Command = typeof Command.Type;

const WayInStep = Schema.Union([
  Command,
  Schema.TaggedStruct("Together", {
    commands: Schema.Array(Command).check(
      Schema.isMinLength(2),
      Schema.isMaxLength(3),
    ),
  }),
]);
type WayInStep = typeof WayInStep.Type;

/**
 * Every sequence makes a passkey, then removes it while the stored password
 * is forgotten, and later forgets the password and removes the last passkey
 * one after the other.
 */
const lastWays: ReadonlyArray<WayInStep> = [
  { _tag: "MakePasskey" },
  {
    _tag: "Together",
    commands: [{ _tag: "RemovePasskey", which: 0 }, { _tag: "ForgetPassword" }],
  },
  { _tag: "MakePasskey" },
  { _tag: "ForgetPassword" },
  { _tag: "RemovePasskey", which: 0 },
  { _tag: "SetPassword", withCurrent: false },
  { _tag: "RemovePasskey", which: 0 },
];

const wayInSequences = Arbitrary.array(Arbitrary.schema(WayInStep), {
  maxLength: 16,
}).pipe(Arbitrary.map((steps) => [...lastWays, ...steps]));

/** The ways in by the commands' own account: the stored password, if any, and the passkeys kept. */
interface Ways {
  readonly password: Option.Option<string>;
  readonly passkeys: ReadonlyArray<PasskeyId>;
}

/** A command as sent: what it names, worked out before it is sent. */
type Sent =
  | { readonly _tag: "MakePasskey" }
  | { readonly _tag: "RemovePasskey"; readonly id: PasskeyId }
  | { readonly _tag: "ForgetPassword" }
  | {
      readonly _tag: "SetPassword";
      readonly current: Option.Option<string>;
      readonly password: string;
    };

/** What a command answers on a hub with these ways in, if it is the only one sent, and the ways in after it. */
const model = (
  configured: boolean,
  ways: Ways,
  sent: Sent,
  made: Option.Option<PasskeyId>,
): { readonly tag: string; readonly ways: Ways } => {
  switch (sent._tag) {
    case "MakePasskey":
      return {
        tag: "Success",
        ways: {
          ...ways,
          passkeys: Option.match(made, {
            onNone: () => ways.passkeys,
            onSome: (id) => [...ways.passkeys, id],
          }),
        },
      };
    case "RemovePasskey": {
      if (!ways.passkeys.includes(sent.id)) {
        return { tag: "NoSuchPasskey", ways };
      }
      const left = ways.passkeys.filter((id) => id !== sent.id);
      if (!configured && Option.isNone(ways.password) && left.length === 0) {
        return { tag: "LastWayIn", ways };
      }
      return { tag: "Success", ways: { ...ways, passkeys: left } };
    }
    case "ForgetPassword":
      if (
        !configured &&
        ways.passkeys.length === 0 &&
        Option.isSome(ways.password)
      ) {
        return { tag: "LastWayIn", ways };
      }
      return { tag: "Success", ways: { ...ways, password: Option.none() } };
    case "SetPassword":
      if (configured) return { tag: "PasswordInConfiguration", ways };
      if (
        Option.isSome(ways.password) &&
        !Option.exists(
          Option.all([sent.current, ways.password]),
          ([given, kept]) => given === kept,
        )
      ) {
        return { tag: "WrongPassword", ways };
      }
      return {
        tag: "Success",
        ways: { ...ways, password: Option.some(sent.password) },
      };
  }
};

const orders = <A>(items: ReadonlyArray<A>): ReadonlyArray<ReadonlyArray<A>> =>
  items.length <= 1
    ? [items]
    : items.flatMap((item, index) =>
        orders([...items.slice(0, index), ...items.slice(index + 1)]).map(
          (rest) => [item, ...rest],
        ),
      );

interface Checked {
  readonly step: number;
  /** Whether the answers and the ways in after them are those of the commands sent in some order, one after another. */
  readonly inSomeOrder: boolean;
  readonly setUp: boolean;
}

/**
 * Sends the commands to a hub set up with a password, from its
 * configuration or by setup, and checks after each step that it is still set
 * up, and that the answers and the ways in left are those of the commands
 * sent one after another, in some order when they were sent together.
 */
const changingWaysIn = (
  configured: boolean,
  sequence: ReadonlyArray<WayInStep>,
) =>
  Effect.gen(function* () {
    const setUpHub = yield* SetUpHub;
    const signInOwner = yield* SignInOwner;
    const removePasskey = yield* RemovePasskey;
    const forgetOwnerPassword = yield* ForgetOwnerPassword;
    const changeOwnerPassword = yield* ChangeOwnerPassword;
    const readWaysIn = yield* ReadWaysIn;
    const passkeys = yield* Passkeys;
    const stored = yield* StoredPasswords;
    const first = configured
      ? Effect.orDie(
          signInOwner.execute({ password: configuredPassword, userAgent }),
        )
      : Effect.orDie(
          setUpHub.execute({
            code: KnownSetupCodes.code,
            password: "chosen-0-4f1a2b",
            userAgent,
          }),
        );
    const signIn: SignInId = (yield* answered(first)).signIn.id;
    let ways: Ways = {
      password: configured ? Option.none() : Option.some("chosen-0-4f1a2b"),
      passkeys: [],
    };
    const removed: Array<PasskeyId> = [];
    const neverKept = PasskeyId.make(Bun.randomUUIDv7());
    const checked: Array<Checked> = [];
    let serial = 0;

    const prepared = (command: Command): Sent => {
      serial += 1;
      switch (command._tag) {
        case "MakePasskey":
        case "ForgetPassword":
          return command;
        case "RemovePasskey":
          return {
            _tag: "RemovePasskey",
            id: ways.passkeys[command.which] ?? removed.at(-1) ?? neverKept,
          };
        case "SetPassword":
          return {
            _tag: "SetPassword",
            current: command.withCurrent
              ? Option.orElse(ways.password, () =>
                  Option.some(`not-${serial}-current`),
                )
              : Option.none(),
            password: `set-${serial}-9d2e40`,
          };
      }
    };

    const send = (sent: Sent) =>
      Effect.gen(function* () {
        switch (sent._tag) {
          case "MakePasskey": {
            const key = yield* Authenticator.makeKey;
            const made = yield* Effect.result(makeWith(key, sites.cota, 0));
            return Result.isSuccess(made)
              ? { tag: "Success", made: Option.some(made.success.id) }
              : { tag: made.failure._tag, made: Option.none<PasskeyId>() };
          }
          case "RemovePasskey":
            return {
              ...(yield* answerOf(removePasskey.execute(sent.id))),
              made: Option.none<PasskeyId>(),
            };
          case "ForgetPassword":
            return {
              ...(yield* answerOf(forgetOwnerPassword.execute)),
              made: Option.none<PasskeyId>(),
            };
          case "SetPassword":
            return {
              ...(yield* answerOf(
                changeOwnerPassword.execute({
                  signIn,
                  current: sent.current,
                  password: sent.password,
                }),
              )),
              made: Option.none<PasskeyId>(),
            };
        }
      });

    for (const [index, step] of sequence.entries()) {
      const commands = step._tag === "Together" ? step.commands : [step];
      const sent = commands.map(prepared);
      const answers = yield* answered(
        Effect.forEach(sent, send, { concurrency: "unbounded" }),
      );
      const kept = yield* Effect.orDie(stored.read);
      const after = {
        hash: Option.map(kept, ({ hash }) => String(hash)),
        passkeys: (yield* Effect.orDie(passkeys.all)).map(({ id }) => id),
      };
      const fitting = orders(sent.map((each, at) => ({ each, at }))).flatMap(
        (order) => {
          let then = ways;
          const tags: Array<string> = [];
          for (const { each, at } of order) {
            const next = model(
              configured,
              then,
              each,
              answers[at]?.made ?? Option.none(),
            );
            tags[at] = next.tag;
            then = next.ways;
          }
          const same =
            tags.every((tag, at) => tag === answers[at]?.tag) &&
            Option.getOrNull(
              Option.map(then.password, (password) =>
                String(FastPasswordHasher.hashOf(password)),
              ),
            ) === Option.getOrNull(after.hash) &&
            [...then.passkeys].sort().join() ===
              [...after.passkeys].sort().join();
          return same ? [then] : [];
        },
      );
      for (const each of sent) {
        if (
          each._tag === "RemovePasskey" &&
          !after.passkeys.includes(each.id)
        ) {
          removed.push(each.id);
        }
      }
      if (fitting[0] !== undefined) ways = fitting[0];
      checked.push({
        step: index,
        inSomeOrder: fitting.length > 0,
        setUp: (yield* Effect.orDie(readWaysIn.execute)).setUp,
      });
      if (answers.some(({ tag }) => tag === "WrongPassword")) {
        yield* TestClock.adjust(Duration.minutes(11));
      }
    }
    return checked;
  });

describe("passkey laws", () => {
  it.effect.prop(
    "I14: a request's Origin gives a relying party exactly when it is https at a host name that is not an IP address, or localhost over http or https, at any port: its host name as the RP ID, and the origin as the URL writes it",
    { origin: Arbitrary.schema(Origin) },
    ({ origin }) =>
      Effect.sync(() => {
        expect(Option.getOrNull(RelyingParty.of(writingOf(origin)))).toEqual(
          expectedOf(origin),
        );
      }),
    { arbitrary: { runs: 500 } },
  );

  it.effect.prop(
    "I15: a challenge is given back once, with what it was issued for, and only while it lasts, 5 minutes from when it was issued; of more than 64 outstanding, the oldest are dropped",
    { sequence: challengeSequences },
    ({ sequence }) =>
      Effect.gen(function* () {
        const { answers, expected } = yield* issueAndTake(sequence);
        expect(answers).toEqual(expected);
      }),
    { arbitrary: { runs: 200 } },
  );

  it.effect.prop(
    "I16: an answer signs in exactly when it is signed by a kept passkey's key, for that passkey's RP ID and origin, over a challenge issued for signing in, not used and still lasting, with the user verified and the counter not behind; every other answer is the one 401 and makes no sign-in",
    { sequence: ceremonies },
    ({ sequence }) =>
      Effect.gen(function* () {
        for (const result of yield* inEachStore(
          true,
          signInsWithFaults(sequence),
        )) {
          expect(result.answers).toEqual(result.expected);
          expect(result.made).toEqual(result.succeeded);
        }
      }),
    { arbitrary: { runs: 40 } },
  );

  it.effect.prop(
    "I17: over any sequence of setting, changing and forgetting the password and making and removing passkeys, sent one after another or together, on hubs with and without a configured password, a hub that was set up stays set up, and the commands refused as the last way in are exactly those that would leave no way in",
    { sequence: wayInSequences },
    ({ sequence }) =>
      Effect.gen(function* () {
        for (const configured of [false, true]) {
          for (const checked of yield* inEachStore(
            configured,
            changingWaysIn(configured, sequence),
          )) {
            expect(checked).toEqual(
              checked.map(({ step }) => ({
                step,
                inSomeOrder: true,
                setUp: true,
              })),
            );
          }
        }
      }),
    { arbitrary: { runs: 40 } },
  );

  it.effect(
    "I7: ten failed passkey sign-ins are answered at once and do not pause the password, and ten wrong passwords do not pause a passkey",
    () =>
      Effect.gen(function* () {
        const signInOwner = yield* SignInOwner;
        const signInWithPasskey = yield* SignInWithPasskey;
        const prepare = yield* PreparePasskeySignIn;
        const key = yield* Authenticator.makeKey;
        const stranger = yield* Authenticator.makeKey;
        yield* Effect.orDie(makeWith(key, sites.cota, 0));
        const failed: Array<Answer> = [];
        for (let time = 0; time < 10; time++) {
          const options = yield* Effect.orDie(
            prepare.execute(sites.cota.origin),
          );
          const response = yield* Authenticator.get({
            credentialId: key.credentialId,
            signer: stranger,
            challenge: options.challenge,
            signing: { ...sites.cota, userVerified: true, counter: 0 },
          });
          failed.push(
            yield* answerOf(signInWithPasskey.execute({ response, userAgent })),
          );
        }
        const password = yield* answered(
          answerOf(
            signInOwner.execute({ password: configuredPassword, userAgent }),
          ),
        );
        const wrong: Array<string> = [];
        for (let time = 0; time < 11; time++) {
          const answer = yield* answered(
            answerOf(
              signInOwner.execute({
                password: `guess-${time}-7a1d`,
                userAgent,
              }),
            ),
          );
          wrong.push(answer.tag);
        }
        const passkey = yield* signInWith(key, sites.cota);
        expect({
          failed,
          password: password.tag,
          wrong,
          passkey,
        }).toEqual({
          failed: failed.map(() => ({ tag: "PasskeyRefused", afterMillis: 0 })),
          password: "Success",
          wrong: [
            ...Array.from({ length: 10 }, () => "WrongPassword"),
            "TooManyAttempts",
          ],
          passkey: { tag: "Success", afterMillis: 0 },
        });
      }).pipe(Effect.provide(inMemory(true))),
  );
});
