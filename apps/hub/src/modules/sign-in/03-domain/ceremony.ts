import { Schema } from "effect";
import { isCharactersBetween } from "#shared/03-domain/text.ts";

/** Bytes as WebAuthn's JSON writes them: base64url, without padding. */
const Base64Url = Schema.String.check(Schema.isPattern(/^[\w-]+$/));

/** A credential id: at most 1,023 bytes (WebAuthn), so at most 1,364 characters of base64url. */
const CredentialIdText = Base64Url.check(isCharactersBetween(1, 1364));

const Transports = Schema.Array(
  Schema.String.check(isCharactersBetween(1, 32)),
).check(Schema.isMaxLength(8));

const Descriptor = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal("public-key"),
  transports: Schema.optionalKey(Schema.Array(Schema.String)),
});

/** The options a browser makes a passkey with (`navigator.credentials.create`), as JSON. */
export const CreationOptions = Schema.Struct({
  challenge: Schema.String,
  rp: Schema.Struct({ name: Schema.String, id: Schema.String }),
  user: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    displayName: Schema.String,
  }),
  pubKeyCredParams: Schema.Array(
    Schema.Struct({ alg: Schema.Int, type: Schema.Literal("public-key") }),
  ),
  timeout: Schema.Int,
  attestation: Schema.Literal("none"),
  excludeCredentials: Schema.Array(Descriptor),
  authenticatorSelection: Schema.Struct({
    residentKey: Schema.Literal("required"),
    requireResidentKey: Schema.Boolean,
    userVerification: Schema.Literal("required"),
  }),
  extensions: Schema.Struct({ credProps: Schema.Boolean }),
}).annotate({ identifier: "PasskeyCreationOptions" });
export type CreationOptions = typeof CreationOptions.Type;

/** The options a browser signs in with a passkey with (`navigator.credentials.get`), as JSON: no credential ids. */
export const RequestOptions = Schema.Struct({
  challenge: Schema.String,
  rpId: Schema.String,
  timeout: Schema.Int,
  userVerification: Schema.Literal("required"),
}).annotate({ identifier: "PasskeyRequestOptions" });
export type RequestOptions = typeof RequestOptions.Type;

/** A browser's answer to creation options, as WebAuthn's JSON writes it. */
export const CreationResponse = Schema.Struct({
  id: CredentialIdText,
  rawId: CredentialIdText,
  type: Schema.Literal("public-key"),
  response: Schema.Struct({
    clientDataJSON: Base64Url,
    attestationObject: Base64Url,
    transports: Schema.optionalKey(Transports),
  }),
}).annotate({ identifier: "PasskeyCreationResponse" });
export type CreationResponse = typeof CreationResponse.Type;

/** A browser's answer to request options, as WebAuthn's JSON writes it. */
export const SignInResponse = Schema.Struct({
  id: CredentialIdText,
  rawId: CredentialIdText,
  type: Schema.Literal("public-key"),
  response: Schema.Struct({
    clientDataJSON: Base64Url,
    authenticatorData: Base64Url,
    signature: Base64Url,
    userHandle: Schema.optionalKey(Base64Url),
  }),
}).annotate({ identifier: "PasskeySignInResponse" });
export type SignInResponse = typeof SignInResponse.Type;
