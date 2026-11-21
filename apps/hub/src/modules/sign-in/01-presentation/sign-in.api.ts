import { Schema } from "effect";
import {
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from "effect/http-api";
import {
  CreationOptions,
  CreationResponse,
  RequestOptions,
  SignInResponse,
} from "#modules/sign-in/03-domain/ceremony.ts";
import {
  CallerMiddleware,
  mayCall,
} from "#shared/01-presentation/caller.middleware.ts";
import { JsonBody } from "#shared/01-presentation/json-body.middleware.ts";
import {
  CrossSite,
  HubStoreProblem,
} from "#shared/01-presentation/problems.ts";
import { HubKey } from "#shared/03-domain/hub-key.ts";
import { PasskeyId, SignInId } from "#shared/03-domain/ids.ts";
import { isCharactersBetween } from "#shared/03-domain/text.ts";

export class NotSetUp extends HttpApiError.Problem<NotSetUp>()("NotSetUp", {
  type: "urn:cota:not-set-up",
  status: 403,
  title: "This hub is not set up, so nobody signs in yet.",
}) {}

export class AlreadySetUp extends HttpApiError.Problem<AlreadySetUp>()(
  "AlreadySetUp",
  {
    type: "urn:cota:already-set-up",
    status: 409,
    title: "This hub is already set up.",
  },
) {}

export class WrongSetupCode extends HttpApiError.Problem<WrongSetupCode>()(
  "WrongSetupCode",
  {
    type: "urn:cota:wrong-setup-code",
    status: 401,
    title: "That is not this hub's setup code.",
  },
) {}

export class PasswordInConfiguration extends HttpApiError.Problem<PasswordInConfiguration>()(
  "PasswordInConfiguration",
  {
    type: "urn:cota:password-in-configuration",
    status: 409,
    title: "The owner password is set in the hub's configuration.",
  },
) {}

export class PasswordOff extends HttpApiError.Problem<PasswordOff>()(
  "PasswordOff",
  {
    type: "urn:cota:password-off",
    status: 403,
    title: "The owner password is off: the owner signs in with a passkey.",
  },
) {}

export class NotAPasskeyOrigin extends HttpApiError.Problem<NotAPasskeyOrigin>()(
  "NotAPasskeyOrigin",
  {
    type: "urn:cota:not-a-passkey-origin",
    status: 400,
    title: "A browser offers no passkey at this request's origin.",
  },
) {}

export class PasskeyNotMade extends HttpApiError.Problem<PasskeyNotMade>()(
  "PasskeyNotMade",
  {
    type: "urn:cota:passkey-not-made",
    status: 400,
    title: "The browser's answer made no passkey.",
  },
) {}

export class PasskeyExists extends HttpApiError.Problem<PasskeyExists>()(
  "PasskeyExists",
  {
    type: "urn:cota:passkey-exists",
    status: 409,
    title: "The hub keeps this passkey already.",
  },
) {}

export class NoSuchPasskey extends HttpApiError.Problem<NoSuchPasskey>()(
  "NoSuchPasskey",
  {
    type: "urn:cota:no-such-passkey",
    status: 404,
    title: "There is no such passkey.",
  },
) {}

export class NoPasskeys extends HttpApiError.Problem<NoPasskeys>()(
  "NoPasskeys",
  {
    type: "urn:cota:no-passkeys",
    status: 409,
    title: "This hub has no passkey to sign in with.",
  },
) {}

export class PasskeyRefused extends HttpApiError.Problem<PasskeyRefused>()(
  "PasskeyRefused",
  {
    type: "urn:cota:passkey-refused",
    status: 401,
    title: "That passkey did not sign in.",
  },
) {}

export class LastWayIn extends HttpApiError.Problem<LastWayIn>()("LastWayIn", {
  type: "urn:cota:last-way-in",
  status: 409,
  title: "That would leave the owner no way in.",
}) {}

export class TooManyAttempts extends HttpApiError.Problem<TooManyAttempts>()(
  "TooManyAttempts",
  {
    type: "urn:cota:too-many-attempts",
    status: 429,
    title: "Too many wrong passwords; signing in is paused.",
  },
) {}

export class WrongPassword extends HttpApiError.Problem<WrongPassword>()(
  "WrongPassword",
  {
    type: "urn:cota:wrong-password",
    status: 401,
    title: "That is not the owner password.",
  },
) {}

export class NoSuchSignIn extends HttpApiError.Problem<NoSuchSignIn>()(
  "NoSuchSignIn",
  {
    type: "urn:cota:no-such-sign-in",
    status: 404,
    title: "There is no such sign-in.",
  },
) {}

const Time = Schema.DateTimeUtcFromString;

export const Me = Schema.Struct({
  caller: Schema.Literals(["owner", "hub-key"]),
  hubKey: Schema.NullOr(HubKey),
  signIn: Schema.NullOr(
    Schema.Struct({ id: SignInId, createdAt: Time, expiresAt: Time }),
  ),
}).annotate({ identifier: "Me" });

export const SignIn = Schema.Struct({
  id: SignInId,
  createdAt: Time,
  expiresAt: Time,
  lastUsedAt: Time,
  userAgent: Schema.String,
  current: Schema.Boolean,
}).annotate({ identifier: "SignIn" });

export const WaysIn = Schema.Struct({
  setUp: Schema.Boolean,
  password: Schema.Boolean,
  passkey: Schema.Boolean,
}).annotate({ identifier: "WaysIn" });

export const Passkey = Schema.Struct({
  id: PasskeyId,
  userAgent: Schema.String,
  origin: Schema.String,
  createdAt: Time,
  lastUsedAt: Schema.NullOr(Time),
}).annotate({ identifier: "Passkey" });

export const OwnerPassword = Schema.Struct({
  source: Schema.Literals(["configuration", "hub-store", "none"]),
  setAt: Schema.NullOr(Time),
}).annotate({ identifier: "OwnerPassword" });

/** A password given to sign in, or as the current one: the configuration's may be short. */
const Password = Schema.String.check(isCharactersBetween(1, 1024));

/** A password chosen in the browser (ADR-0021). */
const NewPassword = Schema.String.check(isCharactersBetween(12, 1024));

const signIn = HttpApiEndpoint.post("signIn", "/sign-in", {
  payload: Schema.Struct({ password: Password }),
  success: HttpApiSchema.NoContent,
  error: [
    CrossSite,
    NotSetUp,
    PasswordOff,
    TooManyAttempts,
    WrongPassword,
    HubStoreProblem,
  ],
});

const waysIn = HttpApiEndpoint.get("waysIn", "/sign-in", {
  success: WaysIn,
  error: HubStoreProblem,
});

const setUp = HttpApiEndpoint.post("setUp", "/setup", {
  payload: Schema.Struct({
    code: Schema.String.check(isCharactersBetween(1, 64)),
    password: NewPassword,
  }),
  success: HttpApiSchema.NoContent,
  error: [
    CrossSite,
    AlreadySetUp,
    TooManyAttempts,
    WrongSetupCode,
    HubStoreProblem,
  ],
});

const ownerPassword = HttpApiEndpoint.get("ownerPassword", "/owner-password", {
  success: OwnerPassword,
}).annotateMerge(mayCall("owner"));

const changeOwnerPassword = HttpApiEndpoint.put(
  "changeOwnerPassword",
  "/owner-password",
  {
    payload: Schema.Struct({
      current: Schema.optionalKey(Password),
      password: NewPassword,
    }),
    success: HttpApiSchema.NoContent,
    error: [PasswordInConfiguration, TooManyAttempts, WrongPassword],
  },
).annotateMerge(mayCall("owner"));

const forgetOwnerPassword = HttpApiEndpoint.delete(
  "forgetOwnerPassword",
  "/owner-password",
  { success: HttpApiSchema.NoContent, error: LastWayIn },
).annotateMerge(mayCall("owner"));

const preparePasskey = HttpApiEndpoint.post(
  "preparePasskey",
  "/passkeys/options",
  { success: CreationOptions, error: NotAPasskeyOrigin },
).annotateMerge(mayCall("owner"));

const makePasskey = HttpApiEndpoint.post("makePasskey", "/passkeys", {
  payload: CreationResponse,
  success: Passkey,
  error: [PasskeyNotMade, PasskeyExists],
}).annotateMerge(mayCall("owner"));

const passkeys = HttpApiEndpoint.get("passkeys", "/passkeys", {
  success: Schema.Struct({ passkeys: Schema.Array(Passkey) }),
}).annotateMerge(mayCall("owner"));

const removePasskey = HttpApiEndpoint.delete("removePasskey", "/passkeys/:id", {
  params: { id: PasskeyId },
  success: HttpApiSchema.NoContent,
  error: [NoSuchPasskey, LastWayIn],
}).annotateMerge(mayCall("owner"));

const preparePasskeySignIn = HttpApiEndpoint.post(
  "preparePasskeySignIn",
  "/sign-in/passkey/options",
  {
    success: RequestOptions,
    error: [CrossSite, NotAPasskeyOrigin, NoPasskeys, HubStoreProblem],
  },
);

const signInWithPasskey = HttpApiEndpoint.post(
  "signInWithPasskey",
  "/sign-in/passkey",
  {
    payload: SignInResponse,
    success: HttpApiSchema.NoContent,
    error: [CrossSite, PasskeyRefused, HubStoreProblem],
  },
);

const signOut = HttpApiEndpoint.post("signOut", "/sign-out", {
  success: HttpApiSchema.NoContent,
}).annotateMerge(mayCall("owner"));

const me = HttpApiEndpoint.get("me", "/me", { success: Me }).annotateMerge(
  mayCall("reader"),
);

const signIns = HttpApiEndpoint.get("signIns", "/sign-ins", {
  success: Schema.Struct({ signIns: Schema.Array(SignIn) }),
}).annotateMerge(mayCall("owner"));

const revokeSignIn = HttpApiEndpoint.delete("revokeSignIn", "/sign-ins/:id", {
  params: { id: SignInId },
  success: HttpApiSchema.NoContent,
  error: NoSuchSignIn,
}).annotateMerge(mayCall("owner"));

const revokeOtherSignIns = HttpApiEndpoint.delete(
  "revokeOtherSignIns",
  "/sign-ins",
  { success: Schema.Struct({ revoked: Schema.Int }) },
).annotateMerge(mayCall("owner"));

/** Setup, signing in and out, the owner password, passkeys and the owner's sign-ins (`docs/specs/sign-in/spec.md`). */
export const group = HttpApiGroup.make("sign-in")
  .add(
    signOut,
    me,
    signIns,
    revokeSignIn,
    revokeOtherSignIns,
    ownerPassword,
    changeOwnerPassword,
    forgetOwnerPassword,
    preparePasskey,
    makePasskey,
    passkeys,
    removePasskey,
  )
  .middleware(CallerMiddleware)
  .add(signIn, waysIn, setUp, preparePasskeySignIn, signInWithPasskey)
  .middleware(JsonBody)
  .middleware(HttpApiMiddleware.ProblemDetails)
  .prefix("/api");
