import { Schema } from "effect";

export const PoolId = Schema.NonEmptyString.pipe(Schema.brand("PoolId"));
export type PoolId = typeof PoolId.Type;

export const LoginFingerprint = Schema.NonEmptyString.pipe(
  Schema.brand("LoginFingerprint"),
);
export type LoginFingerprint = typeof LoginFingerprint.Type;

export const ModelId = Schema.NonEmptyString.pipe(Schema.brand("ModelId"));
export type ModelId = typeof ModelId.Type;

export const HubKeyName = Schema.NonEmptyString.pipe(
  Schema.brand("HubKeyName"),
);
export type HubKeyName = typeof HubKeyName.Type;

export const HubKeyDigest = Schema.NonEmptyString.pipe(
  Schema.brand("HubKeyDigest"),
);
export type HubKeyDigest = typeof HubKeyDigest.Type;

export const SignInId = Schema.NonEmptyString.pipe(Schema.brand("SignInId"));
export type SignInId = typeof SignInId.Type;

export const PasskeyId = Schema.NonEmptyString.pipe(Schema.brand("PasskeyId"));
export type PasskeyId = typeof PasskeyId.Type;
