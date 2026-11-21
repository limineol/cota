import { Database } from "bun:sqlite";
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
import { MakePasskey } from "#modules/sign-in/02-application/commands/make-passkey.command.ts";
import { PreparePasskey } from "#modules/sign-in/02-application/commands/prepare-passkey.command.ts";
import { PreparePasskeySignIn } from "#modules/sign-in/02-application/commands/prepare-passkey-sign-in.command.ts";
import { RevokeOtherSignIns } from "#modules/sign-in/02-application/commands/revoke-other-sign-ins.command.ts";
import { RevokeSignIn } from "#modules/sign-in/02-application/commands/revoke-sign-in.command.ts";
import { SetUpHub } from "#modules/sign-in/02-application/commands/set-up-hub.command.ts";
import {
  type Signed,
  SignInOwner,
} from "#modules/sign-in/02-application/commands/sign-in-owner.command.ts";
import { SignInWithPasskey } from "#modules/sign-in/02-application/commands/sign-in-with-passkey.command.ts";
import { SignIns } from "#modules/sign-in/02-application/interfaces/sign-ins.repository.ts";
import { StoredPasswords } from "#modules/sign-in/02-application/interfaces/stored-passwords.repository.ts";
import { IdentifyOwner } from "#modules/sign-in/02-application/queries/identify-owner.query.ts";
import { ReadOwnerPassword } from "#modules/sign-in/02-application/queries/read-owner-password.query.ts";
import * as Attempts from "#modules/sign-in/03-domain/attempts.ts";
import type { StoredPassword } from "#modules/sign-in/03-domain/owner-password.ts";
import * as SignIn from "#modules/sign-in/03-domain/sign-in.entity.ts";
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
import type { SignInId } from "#shared/03-domain/ids.ts";
import * as HubStore from "#shared/04-infrastructure/hub-store/hub-store.ts";

const configuredPassword = "owner-password-0c3e";
const userAgent = "Mozilla/5.0 Firefox/150.0";

/**
 * The hub's setup code as the owner might type it: as printed, in lower case,
 * without its hyphens, with spaces, and with the letters Crockford's base32
 * reads as its 0 and 1.
 */
const writings = [
  KnownSetupCodes.code,
  KnownSetupCodes.code.toLowerCase(),
  KnownSetupCodes.code.replaceAll("-", ""),
  ` ${KnownSetupCodes.code.toLowerCase().replaceAll("-", " ")} `,
  KnownSetupCodes.code.replaceAll("0", "O").replaceAll("1", "I"),
  KnownSetupCodes.code.toLowerCase().replaceAll("0", "o").replaceAll("1", "l"),
];

const wrongCodes = [
  "K7QM-2F0X-HD1Q",
  "K7QM2F0XHD1",
  "K7QM-2FUX-HD1P",
  "WRONG-CODE-0001",
];

const writing = (index: number) => writings[index % writings.length] ?? "";
const wrongCode = (index: number) =>
  wrongCodes[index % wrongCodes.length] ?? "";

/** The module over the ports given, with the laws' password hasher and setup codes. */
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

const inMemory = (
  configured: boolean,
  before: Option.Option<StoredPassword> = Option.none(),
) =>
  overPorts(configured).pipe(
    Layer.provideMerge(InMemoryWaysIn.layer(before)),
    Layer.provideMerge(InMemorySignIns.layer),
  );

const sqliteStore = (path: string) =>
  Layer.mergeAll(
    SqliteStoredPasswords.layer,
    SqlitePasskeys.layer,
    SqliteSignIns.layer,
  ).pipe(
    Layer.provide(HubStore.layer({ path, steps: SignInModule.steps })),
    Layer.orDie,
  );

const scratch = mkdtempSync(join(tmpdir(), "cota-sign-in-laws-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let stores = 0;
const freshPath = () => {
  stores += 1;
  return join(scratch, `${stores}.sqlite`);
};

const everythingIn = (path: string): string => {
  const database = new Database(path, { readonly: true });
  try {
    const tables = database
      .query("SELECT name FROM sqlite_master WHERE type = 'table'")
      .values()
      .map(([name]) => String(name));
    return JSON.stringify(
      tables.map((table) =>
        database.query(`SELECT * FROM "${table}"`).values(),
      ),
    );
  } finally {
    database.close();
  }
};

type Module =
  | SignInOwner
  | PreparePasskey
  | MakePasskey
  | PreparePasskeySignIn
  | SignInWithPasskey
  | SetUpHub
  | ChangeOwnerPassword
  | RevokeSignIn
  | RevokeOtherSignIns
  | IdentifyOwner
  | ReadOwnerPassword
  | StoredPasswords
  | SignIns;

interface Hub {
  readonly configured: boolean;
  /** The stored password the hub store holds before the hub starts. */
  readonly before: Option.Option<StoredPassword>;
}

interface Kept<A> {
  readonly result: A;
  /** Everything the store holds, as text. */
  readonly everything: string;
}

/**
 * Runs `run` against the module over the in-memory store, and again over a
 * SQLite store in a new file, and gives what each answered and then held.
 */
const inEachStore = <A>(hub: Hub, run: Effect.Effect<A, never, Module>) =>
  Effect.gen(function* () {
    const memory = yield* Effect.gen(function* () {
      const result = yield* run;
      const kept = yield* InMemorySignIns.Kept;
      const stored = yield* StoredPasswords;
      const password = yield* Effect.orDie(stored.read);
      return {
        result,
        everything: JSON.stringify([
          kept.signIns(),
          Option.getOrNull(password),
        ]),
      };
    }).pipe(Effect.provide(inMemory(hub.configured, hub.before)));
    const path = freshPath();
    if (Option.isSome(hub.before)) {
      const before = hub.before.value;
      yield* Effect.gen(function* () {
        const stored = yield* StoredPasswords;
        yield* Effect.orDie(stored.keepFirst(before));
      }).pipe(Effect.provide(sqliteStore(path)));
    }
    const result = yield* run.pipe(
      Effect.provide(
        overPorts(hub.configured).pipe(Layer.provideMerge(sqliteStore(path))),
      ),
    );
    const kept: ReadonlyArray<Kept<A>> = [
      memory,
      { result, everything: everythingIn(path) },
    ];
    return kept;
  });

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

/** Moves the clock to the given time, when it is still to come. */
const moveTo = (at: DateTime.Utc) =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    const ahead = DateTime.toEpochMillis(at) - DateTime.toEpochMillis(now);
    if (ahead > 0) yield* TestClock.adjust(Duration.millis(ahead));
  });

/** How an attempt was answered: its success, or its error's tag, when it began, and how long after. */
interface Answer<A> {
  readonly tag: string;
  readonly value: Option.Option<A>;
  readonly began: number;
  readonly afterMillis: number;
  readonly retryAfterSeconds: number;
}

const answerOf = <A, E extends { readonly _tag: string }, R>(
  effect: Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const began = DateTime.toEpochMillis(yield* DateTime.now);
    const result = yield* Effect.result(effect);
    const afterMillis = DateTime.toEpochMillis(yield* DateTime.now) - began;
    const answer: Answer<A> = Result.isSuccess(result)
      ? {
          tag: "Success",
          value: Option.some(result.success),
          began,
          afterMillis,
          retryAfterSeconds: 0,
        }
      : {
          tag: result.failure._tag,
          value: Option.none(),
          began,
          afterMillis,
          retryAfterSeconds:
            result.failure instanceof Attempts.TooManyAttempts
              ? result.failure.retryAfterSeconds
              : 0,
        };
    return answer;
  });

const liveAmong = (tokens: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const identifyOwner = yield* IdentifyOwner;
    const live: Array<SignInId> = [];
    for (const token of tokens) {
      const found = yield* identifyOwner.execute(token).pipe(Effect.orDie);
      if (Option.isSome(found)) live.push(found.value.id);
    }
    return live;
  });

const day = Duration.toMillis(Duration.days(1));
const windowMillis = Duration.toMillis(Attempts.window);
const pick = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5 }));
const count = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 3 }));

const Step = Schema.Union([
  Schema.TaggedStruct("SignIn", { times: count }),
  Schema.TaggedStruct("Guess", { times: count }),
  Schema.TaggedStruct("Setup", { right: Schema.Boolean }),
  Schema.TaggedStruct("Change", { which: pick, right: Schema.Boolean }),
  Schema.TaggedStruct("MakePasskey", {}),
  Schema.TaggedStruct("PasskeySignIn", { which: pick }),
  Schema.TaggedStruct("SignOut", { which: pick }),
  Schema.TaggedStruct("RevokeOthers", { which: pick }),
  Schema.TaggedStruct("Identify", { which: pick }),
  Schema.TaggedStruct("Wait", {
    millis: Schema.Literals([1, 1000, 60_000, day, 29 * day, 61 * day]),
  }),
  Schema.TaggedStruct("UntilExpiry", {
    which: pick,
    offsetMillis: Schema.Literals([-1, 0, 1]),
  }),
]);
type Step = typeof Step.Type;

/** Every sequence starts at the edge of a sign-in's life: its last live millisecond, its expiry, and the millisecond after. */
const atExpiry: ReadonlyArray<Step> = [
  { _tag: "SignIn", times: 1 },
  { _tag: "UntilExpiry", which: 0, offsetMillis: -1 },
  { _tag: "Identify", which: 0 },
  { _tag: "UntilExpiry", which: 0, offsetMillis: 0 },
  { _tag: "Identify", which: 0 },
  { _tag: "UntilExpiry", which: 0, offsetMillis: 1 },
  { _tag: "Identify", which: 0 },
];

/** A hub whose configuration holds the password, or one set up by its first step, then any steps. */
const sequences = Arbitrary.all([
  Arbitrary.schema(Schema.Boolean),
  Arbitrary.array(Arbitrary.schema(Step), { maxLength: 40 }),
]).pipe(
  Arbitrary.map(([configured, steps]) => {
    const setUp: ReadonlyArray<Step> = configured
      ? []
      : [{ _tag: "Setup", right: true }];
    return { configured, steps: [...setUp, ...atExpiry, ...steps] };
  }),
);

interface Held {
  readonly token: string;
  readonly id: SignInId;
  readonly expiresAt: DateTime.Utc;
}

interface Observed {
  readonly live: ReadonlyArray<SignInId>;
  /** The sign-ins neither revoked by a step before nor expired, by the steps' own account. */
  readonly expected: ReadonlyArray<SignInId>;
}

interface Ending {
  readonly ended: ReadonlyArray<SignInId>;
  readonly named: ReadonlyArray<SignInId>;
}

/** Where the laws' passkeys are made and used. */
const site = { origin: "https://cota.example", rpId: "cota.example" };

/**
 * Runs the steps against the module, noting before each which sign-ins open
 * a caller and which should, after each revocation which ended, every secret
 * given (challenges and passkeys' private keys among them), and the owner
 * password the steps leave.
 */
const run = (configured: boolean, sequence: ReadonlyArray<Step>) =>
  Effect.gen(function* () {
    const signInOwner = yield* SignInOwner;
    const setUpHub = yield* SetUpHub;
    const changeOwnerPassword = yield* ChangeOwnerPassword;
    const revokeSignIn = yield* RevokeSignIn;
    const revokeOtherSignIns = yield* RevokeOtherSignIns;
    const preparePasskey = yield* PreparePasskey;
    const makePasskey = yield* MakePasskey;
    const preparePasskeySignIn = yield* PreparePasskeySignIn;
    const signInWithPasskey = yield* SignInWithPasskey;
    const keys: Array<Authenticator.Key> = [];
    const held: Array<Held> = [];
    const revoked = new Set<SignInId>();
    const secrets: Array<string> = [configuredPassword, ...writings];
    const observed: Array<Observed> = [];
    const endings: Array<Ending> = [];
    let password = configured ? configuredPassword : "";
    const heldAt = (which: number) => held[which % Math.max(held.length, 1)];
    const hold = ({ token, signIn }: Signed) =>
      held.push({ token, id: signIn.id, expiresAt: signIn.expiresAt });
    const tokensHeld = () => held.map(({ token }) => token);

    const observe = Effect.gen(function* () {
      const now = yield* DateTime.now;
      const live = yield* liveAmong(tokensHeld());
      observed.push({
        live,
        expected: held
          .filter(
            ({ id, expiresAt }) =>
              !revoked.has(id) && DateTime.isGreaterThan(expiresAt, now),
          )
          .map(({ id }) => id),
      });
      return live;
    });

    for (const [index, step] of sequence.entries()) {
      const live = yield* observe;
      switch (step._tag) {
        case "SignIn":
          for (let time = 0; time < step.times; time++) {
            const answer = yield* answerOf(
              signInOwner.execute({ password, userAgent }),
            );
            if (Option.isSome(answer.value)) hold(answer.value.value);
          }
          break;
        case "Guess":
          for (let time = 0; time < step.times; time++) {
            const guess = `guess-${index}-${time}-7a1d`;
            secrets.push(guess);
            yield* answered(
              answerOf(signInOwner.execute({ password: guess, userAgent })),
            );
          }
          break;
        case "Setup": {
          const chosen = `chosen-${index}-4f1a2b`;
          secrets.push(chosen);
          const answer = yield* answered(
            answerOf(
              setUpHub.execute({
                code: step.right ? writing(index) : wrongCode(index),
                password: chosen,
                userAgent,
              }),
            ),
          );
          if (Option.isSome(answer.value)) {
            hold(answer.value.value);
            password = chosen;
          }
          break;
        }
        case "Change": {
          const each = heldAt(step.which);
          if (each === undefined || !live.includes(each.id)) break;
          const current = step.right ? password : `not-${index}-current-7c`;
          const next = `changed-${index}-9d2e40`;
          secrets.push(current, next);
          const answer = yield* answered(
            answerOf(
              changeOwnerPassword.execute({
                signIn: each.id,
                current: Option.some(current),
                password: next,
              }),
            ),
          );
          if (answer.tag === "Success") {
            password = next;
            for (const id of live) if (id !== each.id) revoked.add(id);
          }
          break;
        }
        case "MakePasskey": {
          const key = yield* Authenticator.makeKey;
          const options = yield* Effect.orDie(
            preparePasskey.execute(site.origin),
          );
          secrets.push(key.secret, options.challenge);
          yield* Effect.orDie(
            makePasskey.execute({
              response: Authenticator.create(key, options.challenge, {
                ...site,
                userVerified: true,
                counter: 0,
              }),
              userAgent,
            }),
          );
          keys.push(key);
          break;
        }
        case "PasskeySignIn": {
          const key = keys[step.which % Math.max(keys.length, 1)];
          if (key === undefined) break;
          const options = yield* Effect.orDie(
            preparePasskeySignIn.execute(site.origin),
          );
          secrets.push(options.challenge);
          const response = yield* Authenticator.get({
            credentialId: key.credentialId,
            signer: key,
            challenge: options.challenge,
            signing: { ...site, userVerified: true, counter: 0 },
          });
          hold(
            yield* Effect.orDie(
              signInWithPasskey.execute({ response, userAgent }),
            ),
          );
          break;
        }
        case "Wait":
          yield* TestClock.adjust(Duration.millis(step.millis));
          break;
        case "UntilExpiry": {
          const each = heldAt(step.which);
          if (each === undefined) break;
          yield* moveTo(
            DateTime.addDuration(
              each.expiresAt,
              Duration.millis(step.offsetMillis),
            ),
          );
          break;
        }
        case "Identify": {
          const each = heldAt(step.which);
          if (each !== undefined) yield* liveAmong([each.token]);
          break;
        }
        case "SignOut": {
          const each = heldAt(step.which);
          if (each === undefined) break;
          yield* Effect.ignore(revokeSignIn.execute(each.id));
          const after = yield* liveAmong(tokensHeld());
          if (live.includes(each.id)) revoked.add(each.id);
          endings.push({
            ended: live.filter((id) => !after.includes(id)),
            named: live.filter((id) => id === each.id),
          });
          break;
        }
        case "RevokeOthers": {
          const each = heldAt(step.which);
          if (each === undefined) break;
          yield* revokeOtherSignIns.execute(each.id).pipe(Effect.orDie);
          const after = yield* liveAmong(tokensHeld());
          const named = live.filter((id) => id !== each.id);
          for (const id of named) revoked.add(id);
          endings.push({
            ended: live.filter((id) => !after.includes(id)),
            named,
          });
        }
      }
    }
    yield* observe;
    return {
      secrets: [...secrets, ...tokensHeld()],
      password,
      observed,
      endings,
    };
  });

const Kind = Schema.Literals(["sign-in", "setup", "change"]);
type Kind = typeof Kind.Type;

const Attempt = Schema.Union([
  Schema.TaggedStruct("Attempt", {
    kind: Kind,
    guess: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 9 })),
    times: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 })),
  }),
  Schema.TaggedStruct("Together", {
    kind: Kind,
    times: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 12 })),
  }),
  Schema.TaggedStruct("Wait", {
    seconds: Schema.Literals([1, 5, 30, 61, 299]),
  }),
  Schema.TaggedStruct("UntilOldestAges", {
    offsetMillis: Schema.Literals([-1, 0, 1]),
  }),
]);
type Attempt = typeof Attempt.Type;

const steps = Arbitrary.array(Arbitrary.schema(Attempt), { maxLength: 12 });

/**
 * Every sequence passes the edge of the window: once the window is clear (and
 * the hub set up, unless the edge is of setup codes), twelve wrong guesses of
 * one kind sent together, then an attempt a millisecond before, at, and a
 * millisecond after the oldest of them is 10 minutes old.
 */
const atTheEdge = (kind: Kind): ReadonlyArray<Attempt> => {
  const setUp: ReadonlyArray<Attempt> =
    kind === "setup"
      ? []
      : [{ _tag: "Attempt", kind: "setup", guess: 0, times: 1 }];
  return [
    { _tag: "Wait", seconds: 299 },
    { _tag: "Wait", seconds: 299 },
    { _tag: "Wait", seconds: 61 },
    ...setUp,
    { _tag: "Together", kind, times: 12 },
    { _tag: "UntilOldestAges", offsetMillis: -1 },
    { _tag: "Attempt", kind, guess: 2, times: 1 },
    { _tag: "UntilOldestAges", offsetMillis: 0 },
    { _tag: "Attempt", kind, guess: 3, times: 1 },
    { _tag: "UntilOldestAges", offsetMillis: 1 },
    { _tag: "Attempt", kind, guess: 0, times: 1 },
  ];
};

const attempts = Arbitrary.all([steps, Arbitrary.schema(Kind), steps]).pipe(
  Arbitrary.map(([before, kind, after]) => [
    ...before,
    ...atTheEdge(kind),
    ...after,
  ]),
);

interface Tried {
  readonly kind: Kind;
  readonly right: boolean;
  readonly answer: Answer<unknown>;
}

const isWrong = ({ tag }: Answer<unknown>) =>
  tag === "WrongPassword" || tag === "WrongSetupCode";

/**
 * Sends the attempts, of every kind, to a hub that is not set up: setups,
 * sign-ins, and changes of the password by the latest sign-in once there is
 * one. A right attempt gives what is right at its time.
 */
const attempt = (sequence: ReadonlyArray<Attempt>) =>
  Effect.gen(function* () {
    const signInOwner = yield* SignInOwner;
    const setUpHub = yield* SetUpHub;
    const changeOwnerPassword = yield* ChangeOwnerPassword;
    const tried: Array<Tried> = [];
    let password = "";
    let latest = Option.none<SignInId>();
    let made = 0;

    const once = (kind: Kind, right: boolean) =>
      Effect.gen(function* () {
        made += 1;
        const serial = made;
        switch (kind) {
          case "sign-in": {
            const answer = yield* answerOf(
              signInOwner.execute({
                password: right ? password : `guess-${serial}-7a1d`,
                userAgent,
              }),
            );
            if (Option.isSome(answer.value)) {
              latest = Option.some(answer.value.value.signIn.id);
            }
            return Option.some<Answer<unknown>>(answer);
          }
          case "setup": {
            const chosen = `chosen-${serial}-4f1a2b`;
            const answer = yield* answerOf(
              setUpHub.execute({
                code: right ? writing(serial) : `WRONG-CODE-${serial}`,
                password: chosen,
                userAgent,
              }),
            );
            if (Option.isSome(answer.value)) {
              latest = Option.some(answer.value.value.signIn.id);
              password = chosen;
            }
            return Option.some<Answer<unknown>>(answer);
          }
          case "change": {
            if (Option.isNone(latest)) return Option.none<Answer<unknown>>();
            const next = `changed-${serial}-9d2e40`;
            const answer = yield* answerOf(
              changeOwnerPassword.execute({
                signIn: latest.value,
                current: Option.some(
                  right ? password : `not-current-${serial}`,
                ),
                password: next,
              }),
            );
            if (answer.tag === "Success") password = next;
            return Option.some<Answer<unknown>>(answer);
          }
        }
      });

    for (const step of sequence) {
      switch (step._tag) {
        case "Wait":
          yield* TestClock.adjust(Duration.seconds(step.seconds));
          break;
        case "UntilOldestAges": {
          const now = DateTime.toEpochMillis(yield* DateTime.now);
          const recent = tried
            .filter(({ answer }) => isWrong(answer))
            .map(({ answer }) => answer.began)
            .filter((at) => at > now - windowMillis);
          if (recent.length > 0) {
            yield* moveTo(
              DateTime.makeUnsafe(
                Math.min(...recent) + windowMillis + step.offsetMillis,
              ),
            );
          }
          break;
        }
        case "Attempt":
          for (let time = 0; time < step.times; time++) {
            const right = step.guess === 0;
            const answer = yield* answered(once(step.kind, right));
            if (Option.isSome(answer)) {
              tried.push({ kind: step.kind, right, answer: answer.value });
            }
          }
          break;
        case "Together": {
          const answers = yield* answered(
            Effect.forEach(
              Array.from({ length: step.times }, () => step.kind),
              (kind) => once(kind, false),
              { concurrency: "unbounded" },
            ),
          );
          for (const answer of answers
            .flatMap((each) => (Option.isSome(each) ? [each.value] : []))
            .sort((one, other) => one.began - other.began)) {
            tried.push({ kind: step.kind, right: false, answer });
          }
        }
      }
    }
    return tried;
  }).pipe(Effect.provide(inMemory(false)));

/** The answers the attempt limit gives the attempts, from their kinds, times and rightness alone. */
const limitedAnswers = (tried: ReadonlyArray<Tried>) => {
  const failures: Array<number> = [];
  let setUp = false;
  return tried.map(({ kind, right, answer: { began } }) => {
    if (kind === "sign-in" && !setUp) return { tag: "NotSetUp" };
    if (kind === "setup" && setUp) return { tag: "AlreadySetUp" };
    const recent = failures.filter((failed) => failed > began - windowMillis);
    if (recent.length >= Attempts.limit) {
      return {
        tag: "TooManyAttempts",
        retryAfterSeconds: Math.ceil(
          (Math.min(...recent) + windowMillis - began) / 1000,
        ),
      };
    }
    if (right) {
      if (kind === "setup") setUp = true;
      return { tag: "Success" };
    }
    failures.push(began);
    return { tag: kind === "setup" ? "WrongSetupCode" : "WrongPassword" };
  });
};

/** A setup's code: one of the writings of the hub's code, or one of the wrong codes after them. */
const Code = Schema.Int.check(
  Schema.isBetween({
    minimum: 0,
    maximum: writings.length + wrongCodes.length - 1,
  }),
);

const SetupStep = Schema.Union([
  Schema.TaggedStruct("Setup", { code: Code }),
  Schema.TaggedStruct("Together", {
    codes: Schema.Array(Code).check(
      Schema.isMinLength(2),
      Schema.isMaxLength(4),
    ),
  }),
  Schema.TaggedStruct("Wait", { seconds: Schema.Literals([1, 61, 601]) }),
]);
type SetupStep = typeof SetupStep.Type;

const setupSteps = Arbitrary.array(Arbitrary.schema(SetupStep), {
  maxLength: 10,
});

/** Every sequence sends, at some point, the hub's code in two writings together, with a wrong code between them. */
const setups = Arbitrary.all([setupSteps, setupSteps]).pipe(
  Arbitrary.map(
    ([before, after]): ReadonlyArray<SetupStep> => [
      ...before,
      { _tag: "Together", codes: [1, writings.length, 3] },
      ...after,
    ],
  ),
);

interface Sent {
  readonly step: number;
  readonly right: boolean;
  readonly password: string;
  readonly answer: Answer<unknown>;
}

/** Sends the setups, then tries to sign in with every password they gave, the window cleared before each. */
const setUpWith = (sequence: ReadonlyArray<SetupStep>) =>
  Effect.gen(function* () {
    const setUpHub = yield* SetUpHub;
    const signInOwner = yield* SignInOwner;
    const signIns = yield* SignIns;
    const stored = yield* StoredPasswords;
    const sent: Array<Sent> = [];
    let made = 0;
    const setUp = (step: number, code: number) =>
      Effect.gen(function* () {
        made += 1;
        const password = `chosen-${made}-4f1a2b`;
        const right = code < writings.length;
        const answer = yield* answerOf(
          setUpHub.execute({
            code: right ? writing(code) : wrongCode(code - writings.length),
            password,
            userAgent,
          }),
        );
        const each: Sent = { step, right, password, answer };
        return each;
      });
    for (const [index, step] of sequence.entries()) {
      switch (step._tag) {
        case "Setup":
          sent.push(yield* answered(setUp(index, step.code)));
          break;
        case "Together": {
          const answers = yield* answered(
            Effect.forEach(step.codes, (code) => setUp(index, code), {
              concurrency: "unbounded",
            }),
          );
          sent.push(
            ...answers.sort(
              (one, other) => one.answer.began - other.answer.began,
            ),
          );
          break;
        }
        case "Wait":
          yield* TestClock.adjust(Duration.seconds(step.seconds));
      }
    }
    const kept = yield* Effect.orDie(stored.read);
    const signInsMade = (yield* Effect.orDie(signIns.all)).length;
    const signedInWith: Array<string> = [];
    for (const { password } of sent) {
      yield* TestClock.adjust(Duration.millis(windowMillis + 1));
      const answer = yield* answered(
        answerOf(signInOwner.execute({ password, userAgent })),
      );
      if (answer.tag === "Success") signedInWith.push(password);
    }
    return { sent, kept, signInsMade, signedInWith };
  });

/**
 * What the setups should be answered, from their codes and times alone: a
 * right code compared while the hub is not set up is a candidate, and the
 * hub is set up by one candidate of the first step that has any.
 */
const expectedSetups = (sent: ReadonlyArray<Sent>) => {
  const failures: Array<number> = [];
  const expected: Array<string> = [];
  let setUpBy = Option.none<number>();
  for (const { step, right, answer } of sent) {
    if (Option.exists(setUpBy, (by) => by !== step)) {
      expected.push("AlreadySetUp");
      continue;
    }
    const recent = failures.filter(
      (failed) => failed > answer.began - windowMillis,
    );
    if (recent.length >= Attempts.limit) expected.push("TooManyAttempts");
    else if (right) {
      setUpBy = Option.some(step);
      expected.push("Candidate");
    } else {
      failures.push(answer.began);
      expected.push("WrongSetupCode");
    }
  }
  return expected;
};

const storedPassword = "a stored password 2a4e";
const otherPassword = "neither password 61b3";

const Which = Schema.Literals(["configured", "stored", "other"]);

const ConfiguredStep = Schema.Union([
  Schema.TaggedStruct("SignIn", { with: Which }),
  Schema.TaggedStruct("Setup", { right: Schema.Boolean }),
  Schema.TaggedStruct("Change", { current: Which }),
  Schema.TaggedStruct("Wait", { seconds: Schema.Literals([1, 601]) }),
]);
type ConfiguredStep = typeof ConfiguredStep.Type;

/** Every sequence signs in with the stored password and the configured one, sets up with the right code, and changes the password giving the stored one. */
const configuredSequences = Arbitrary.array(Arbitrary.schema(ConfiguredStep), {
  maxLength: 20,
}).pipe(
  Arbitrary.map(
    (steps): ReadonlyArray<ConfiguredStep> => [
      { _tag: "SignIn", with: "stored" },
      { _tag: "SignIn", with: "configured" },
      { _tag: "Setup", right: true },
      { _tag: "Change", current: "stored" },
      ...steps,
    ],
  ),
);

const passwordFor = {
  configured: configuredPassword,
  stored: storedPassword,
  other: otherPassword,
};

/** Sends the steps to a hub whose configuration holds a password and whose store holds another, and counts what the configuration's password did not decide. */
const onAConfiguredHub = (sequence: ReadonlyArray<ConfiguredStep>) =>
  Effect.gen(function* () {
    const signInOwner = yield* SignInOwner;
    const setUpHub = yield* SetUpHub;
    const changeOwnerPassword = yield* ChangeOwnerPassword;
    const readOwnerPassword = yield* ReadOwnerPassword;
    const stored = yield* StoredPasswords;
    let signedInWithStored = 0;
    let configuredRefused = 0;
    let setupsNotRefused = 0;
    let changesNotRefused = 0;
    let latest = Option.none<SignInId>();
    for (const [index, step] of sequence.entries()) {
      switch (step._tag) {
        case "SignIn": {
          const answer = yield* answered(
            answerOf(
              signInOwner.execute({
                password: passwordFor[step.with],
                userAgent,
              }),
            ),
          );
          if (Option.isSome(answer.value)) {
            latest = Option.some(answer.value.value.signIn.id);
          }
          if (step.with === "stored" && answer.tag === "Success") {
            signedInWithStored += 1;
          }
          if (step.with === "configured" && answer.tag === "WrongPassword") {
            configuredRefused += 1;
          }
          break;
        }
        case "Setup": {
          const answer = yield* answered(
            answerOf(
              setUpHub.execute({
                code: step.right ? writing(index) : wrongCode(index),
                password: `chosen-${index}-4f1a2b`,
                userAgent,
              }),
            ),
          );
          if (answer.tag !== "AlreadySetUp") setupsNotRefused += 1;
          break;
        }
        case "Change": {
          if (Option.isNone(latest)) break;
          const answer = yield* answered(
            answerOf(
              changeOwnerPassword.execute({
                signIn: latest.value,
                current: Option.some(passwordFor[step.current]),
                password: `changed-${index}-9d2e40`,
              }),
            ),
          );
          if (answer.tag !== "PasswordInConfiguration") changesNotRefused += 1;
          break;
        }
        case "Wait":
          yield* TestClock.adjust(Duration.seconds(step.seconds));
      }
    }
    const after = yield* Effect.orDie(stored.read);
    const { source } = yield* Effect.orDie(readOwnerPassword.execute);
    return {
      signedInWithStored,
      configuredRefused,
      setupsNotRefused,
      changesNotRefused,
      storedUnchanged: Option.exists(
        after,
        ({ hash }) => hash === FastPasswordHasher.hashOf(storedPassword),
      )
        ? 1
        : 0,
      fromTheConfiguration: source === "configuration" ? 1 : 0,
    };
  });

const ChangeStep = Schema.Union([
  Schema.TaggedStruct("SignIn", { times: count }),
  Schema.TaggedStruct("Change", { which: pick, racing: Schema.Boolean }),
  Schema.TaggedStruct("Together", {
    times: Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 3 })),
  }),
  Schema.TaggedStruct("Wait", { seconds: Schema.Literals([1, 61, 601]) }),
]);
type ChangeStep = typeof ChangeStep.Type;

/**
 * Every sequence changes the password once while a sign-in with the old one
 * is made, once with no sign-in made, and twice at once from two sign-ins.
 */
const changes = Arbitrary.array(Arbitrary.schema(ChangeStep), {
  maxLength: 12,
}).pipe(
  Arbitrary.map(
    (steps): ReadonlyArray<ChangeStep> => [
      { _tag: "SignIn", times: 2 },
      { _tag: "Change", which: 1, racing: true },
      { _tag: "SignIn", times: 1 },
      { _tag: "Change", which: 0, racing: false },
      { _tag: "Together", times: 2 },
      ...steps,
    ],
  ),
);

interface AfterChange {
  readonly changerLive: number;
  readonly othersLive: number;
  readonly oldSignsIn: number;
  readonly newSignsIn: number;
}

interface AfterTogether {
  readonly made: number;
  readonly answeredWrong: number;
  readonly winnerLive: number;
  readonly othersLive: number;
  readonly signsIn: ReadonlyArray<number>;
}

/**
 * Sets the hub up, then sends the steps; after each change, notes whether
 * the sign-in that made it is live, how many others are, and whether the old
 * password and the new one sign in. After changes sent together, each by a
 * sign-in of its own, notes how many were made and answered as a wrong
 * password, and which of the old password and the ones given sign in.
 */
const changing = (sequence: ReadonlyArray<ChangeStep>) =>
  Effect.gen(function* () {
    const signInOwner = yield* SignInOwner;
    const setUpHub = yield* SetUpHub;
    const changeOwnerPassword = yield* ChangeOwnerPassword;
    let password = "chosen-at-setup-4f1a2b";
    const held: Array<Signed> = [
      yield* Effect.orDie(
        setUpHub.execute({ code: KnownSetupCodes.code, password, userAgent }),
      ),
    ];
    const signsInWith = (given: string) =>
      Effect.gen(function* () {
        const answer = yield* answered(
          answerOf(signInOwner.execute({ password: given, userAgent })),
        );
        if (Option.isSome(answer.value)) held.push(answer.value.value);
        return answer.tag === "Success" ? 1 : 0;
      });
    const after: Array<AfterChange> = [];
    const together: Array<AfterTogether> = [];
    for (const [index, step] of sequence.entries()) {
      switch (step._tag) {
        case "SignIn":
          for (let time = 0; time < step.times; time++) {
            yield* signsInWith(password);
          }
          break;
        case "Wait":
          yield* TestClock.adjust(Duration.seconds(step.seconds));
          break;
        case "Change": {
          const changer = held[step.which % held.length];
          if (changer === undefined) break;
          if ((yield* liveAmong([changer.token])).length === 0) break;
          const old = password;
          const next = `changed-${index}-9d2e40`;
          const change = yield* Effect.forkChild(
            Effect.orDie(
              changeOwnerPassword.execute({
                signIn: changer.signIn.id,
                current: Option.some(old),
                password: next,
              }),
            ),
          );
          if (step.racing) {
            yield* Effect.yieldNow;
            yield* signsInWith(old);
          }
          yield* answered(Fiber.join(change));
          password = next;
          const others = held.filter(
            ({ signIn }) => signIn.id !== changer.signIn.id,
          );
          after.push({
            changerLive: (yield* liveAmong([changer.token])).length,
            othersLive: (yield* liveAmong(others.map(({ token }) => token)))
              .length,
            oldSignsIn: yield* signsInWith(old),
            newSignsIn: yield* signsInWith(next),
          });
          yield* TestClock.adjust(Duration.millis(windowMillis + 1));
          break;
        }
        case "Together": {
          const changers: Array<Signed> = [];
          for (let time = 0; time < step.times; time++) {
            const answer = yield* answered(
              answerOf(signInOwner.execute({ password, userAgent })),
            );
            if (Option.isSome(answer.value)) changers.push(answer.value.value);
          }
          const old = password;
          const given = changers.map(
            (_, time) => `together-${index}-${time}-9d2e40`,
          );
          const answers = yield* answered(
            Effect.forEach(
              changers,
              (changer, time) =>
                answerOf(
                  changeOwnerPassword.execute({
                    signIn: changer.signIn.id,
                    current: Option.some(old),
                    password: given[time] ?? "",
                  }),
                ),
              { concurrency: "unbounded" },
            ),
          );
          const winner = answers.findIndex(({ tag }) => tag === "Success");
          password = given[winner] ?? old;
          const winning = changers[winner];
          held.push(...changers);
          const others = held.filter(
            ({ signIn }) => signIn.id !== winning?.signIn.id,
          );
          const signsIn: Array<number> = [];
          for (const each of [old, ...given]) {
            signsIn.push(yield* signsInWith(each));
          }
          together.push({
            made: answers.filter(({ tag }) => tag === "Success").length,
            answeredWrong: answers.filter(({ tag }) => tag === "WrongPassword")
              .length,
            winnerLive:
              winning === undefined
                ? 0
                : (yield* liveAmong([winning.token])).length,
            othersLive: (yield* liveAmong(others.map(({ token }) => token)))
              .length,
            signsIn,
          });
          yield* TestClock.adjust(Duration.millis(windowMillis + 1));
        }
      }
    }
    return { after, together };
  });

describe("sign-in laws", () => {
  it.effect.prop(
    "I4: after any sequence of setups, sign-ins with a password or a passkey, changes of the password, passkeys made, sign-outs and revocations, the hub store holds no token, no setup code, no password in the clear, no challenge and no passkey's private key: SHA-256 digests of tokens, one hash of the stored password, and passkeys' public keys, which are not secrets",
    { sequence: sequences },
    ({ sequence }) =>
      Effect.gen(function* () {
        for (const { result, everything } of yield* inEachStore(
          { configured: sequence.configured, before: Option.none() },
          run(sequence.configured, sequence.steps),
        )) {
          const hashes = everything.split(FastPasswordHasher.prefix).length - 1;
          const current = everything.includes(
            FastPasswordHasher.hashOf(result.password),
          )
            ? 1
            : 0;
          expect([
            result.secrets.filter((secret) => everything.includes(secret))
              .length,
            hashes,
            current,
          ]).toEqual(sequence.configured ? [0, 0, 0] : [0, 1, 1]);
        }
      }),
    { arbitrary: { runs: 200 } },
  );

  it.effect.prop(
    "I5: a token whose sign-in is revoked, or whose expiresAt is not after now, makes no caller",
    { sequence: sequences },
    ({ sequence }) =>
      Effect.gen(function* () {
        for (const { result } of yield* inEachStore(
          { configured: sequence.configured, before: Option.none() },
          run(sequence.configured, sequence.steps),
        )) {
          expect(result.observed.map(({ live }) => live)).toEqual(
            result.observed.map(({ expected }) => expected),
          );
        }
      }),
    { arbitrary: { runs: 200 } },
  );

  it.effect.prop(
    "I6: signing out, or revoking by id, ends exactly the sign-in named and no other",
    { sequence: sequences },
    ({ sequence }) =>
      Effect.gen(function* () {
        for (const { result } of yield* inEachStore(
          { configured: sequence.configured, before: Option.none() },
          run(sequence.configured, sequence.steps),
        )) {
          expect(result.endings.map(({ ended }) => ended)).toEqual(
            result.endings.map(({ named }) => named),
          );
        }
      }),
    { arbitrary: { runs: 200 } },
  );

  it.effect.prop(
    "I7: in any 10 minutes at most 10 wrong passwords, setup codes and current passwords are compared, whether sent one after another or together; once 10 have been, every attempt that would be compared is answered 429 until the oldest of them is 10 minutes old, whatever it gives",
    { sequence: attempts },
    ({ sequence }) =>
      Effect.gen(function* () {
        const tried = yield* attempt(sequence);
        const compared = tried
          .filter(({ answer }) => isWrong(answer))
          .map(({ answer }) => answer.began);
        expect(
          compared.filter(
            (at) =>
              compared.filter(
                (other) => other <= at && other > at - windowMillis,
              ).length > Attempts.limit,
          ).length,
        ).toEqual(0);
        expect(
          tried.map(({ answer }) =>
            answer.tag === "TooManyAttempts"
              ? { tag: answer.tag, retryAfterSeconds: answer.retryAfterSeconds }
              : { tag: answer.tag },
          ),
        ).toEqual(limitedAnswers(tried));
      }),
    { arbitrary: { runs: 300 } },
  );

  it.effect.prop(
    "I8: no 401 urn:cota:wrong-password or urn:cota:wrong-setup-code is answered less than one second after its request arrived",
    { sequence: attempts },
    ({ sequence }) =>
      Effect.gen(function* () {
        const early = (yield* attempt(sequence)).filter(
          ({ answer }) =>
            isWrong(answer) &&
            answer.afterMillis < Duration.toMillis(Attempts.wrongGuessDelay),
        );
        expect(early.length).toEqual(0);
      }),
    { arbitrary: { runs: 300 } },
  );

  it.effect.prop(
    "I11: over any sequence of setups with right and wrong codes, the right ones in any writing, sent one after another or together, and any passwords, the password stored is the one given by the first setup that held the hub's setup code, and no other setup changes anything or signs anyone in",
    { sequence: setups },
    ({ sequence }) =>
      Effect.gen(function* () {
        for (const { result } of yield* inEachStore(
          { configured: false, before: Option.none() },
          setUpWith(sequence),
        )) {
          const expected = expectedSetups(result.sent);
          const answers = result.sent.map(({ answer }, index) =>
            expected[index] === "Candidate" &&
            (answer.tag === "Success" || answer.tag === "AlreadySetUp")
              ? "Candidate"
              : answer.tag,
          );
          const candidates = result.sent.filter(
            (_, index) => expected[index] === "Candidate",
          );
          const winners = result.sent.filter(
            ({ answer }) => answer.tag === "Success",
          );
          const setUp = candidates.length > 0 ? 1 : 0;
          expect([
            answers.filter((tag, index) => tag !== expected[index]).length,
            winners.length,
            winners.filter(({ step }) => step === candidates[0]?.step).length,
            result.signInsMade,
            Option.exists(result.kept, ({ hash }) =>
              winners.some(
                ({ password }) => FastPasswordHasher.hashOf(password) === hash,
              ),
            )
              ? 1
              : 0,
            result.signedInWith.length,
            winners.filter(({ password }) =>
              result.signedInWith.includes(password),
            ).length,
          ]).toEqual([0, setUp, setUp, setUp, setUp, setUp, setUp]);
        }
      }),
    { arbitrary: { runs: 200 } },
  );

  it.effect.prop(
    "I12: on a hub whose configuration holds an owner password, setup and changing the password are refused, and no stored password signs in, whatever the store holds",
    { sequence: configuredSequences },
    ({ sequence }) =>
      Effect.gen(function* () {
        const before: StoredPassword = {
          hash: FastPasswordHasher.hashOf(storedPassword),
          setAt: DateTime.makeUnsafe(0),
        };
        for (const { result } of yield* inEachStore(
          { configured: true, before: Option.some(before) },
          onAConfiguredHub(sequence),
        )) {
          expect(result).toEqual({
            signedInWithStored: 0,
            configuredRefused: 0,
            setupsNotRefused: 0,
            changesNotRefused: 0,
            storedUnchanged: 1,
            fromTheConfiguration: 1,
          });
        }
      }),
    { arbitrary: { runs: 100 } },
  );

  it.effect.prop(
    "I13: after a change, the new password signs in and the old one does not, the sign-in that made the change is live, and every other is revoked, one made with the old password while the change was made among them; of changes sent together, one is made and the others are answered as a wrong password",
    { sequence: changes },
    ({ sequence }) =>
      Effect.gen(function* () {
        for (const { result } of yield* inEachStore(
          { configured: false, before: Option.none() },
          changing(sequence),
        )) {
          expect(result.after).toEqual(
            result.after.map(() => ({
              changerLive: 1,
              othersLive: 0,
              oldSignsIn: 0,
              newSignsIn: 1,
            })),
          );
          expect(
            result.together.map(({ signsIn, ...rest }) => ({
              ...rest,
              oldSignsIn: signsIn[0],
              givenSignIn: signsIn.slice(1).filter((one) => one === 1).length,
            })),
          ).toEqual(
            result.together.map(({ signsIn }) => ({
              made: 1,
              answeredWrong: signsIn.length - 2,
              winnerLive: 1,
              othersLive: 0,
              oldSignsIn: 0,
              givenSignIn: 1,
            })),
          );
        }
      }),
    { arbitrary: { runs: 100 } },
  );
});

describe("sign-in", () => {
  it.effect("a sign-in lasts 30 days from when it was made", () =>
    Effect.gen(function* () {
      const made = yield* SignIn.make(
        SignIn.TokenDigest.make("0".repeat(64)),
        "x".repeat(300),
      );
      expect([
        DateTime.formatIso(made.createdAt),
        DateTime.formatIso(made.expiresAt),
        made.userAgent.length,
      ]).toEqual(["1970-01-01T00:00:00.000Z", "1970-01-31T00:00:00.000Z", 200]);
    }),
  );
});
