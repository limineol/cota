import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { Duration, Effect, Layer, Option, Schema } from "effect";
import { WebAuthn } from "#modules/sign-in/02-application/interfaces/web-authn.ts";
import { Challenge, lifetime } from "#modules/sign-in/03-domain/challenges.ts";
import * as Passkey from "#modules/sign-in/03-domain/passkey.ts";

/** EdDSA, ES256 and RS256, as COSE numbers them: the keys a passkey may have, offered and checked alike. */
const algorithms = [-8, -7, -257];

/** How long the browser may take, in milliseconds: as long as the challenge lasts. */
const timeout = Duration.toMillis(lifetime);

const ownerHandle = new TextEncoder().encode(Passkey.owner.handle);

const bytesOf = (base64url: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(Buffer.from(base64url, "base64url"));

const ClientData = Schema.fromJsonString(
  Schema.Struct({ challenge: Challenge }),
);

const decodeClientData = Schema.decodeUnknownOption(ClientData);

/** What the library answered, or none when it threw: it throws for most checks that fail. */
const unlessThrown = <A>(verify: () => Promise<A>) =>
  Effect.tryPromise({ try: verify, catch: () => "not verified" }).pipe(
    Effect.option,
  );

/** Passkeys made and checked by `@simplewebauthn/server`, with challenges from the platform's cryptographic source. */
export const layer: Layer.Layer<WebAuthn> = Layer.succeed(
  WebAuthn,
  WebAuthn.of({
    challenge: Effect.sync(() =>
      Challenge.make(
        Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
          "base64url",
        ),
      ),
    ),
    creationOptions: ({ relyingParty, challenge, exclude }) =>
      Effect.gen(function* () {
        const options = yield* Effect.promise(() =>
          generateRegistrationOptions({
            rpName: Passkey.relyingPartyName,
            rpID: relyingParty.id,
            userID: ownerHandle,
            userName: Passkey.owner.name,
            userDisplayName: Passkey.owner.displayName,
            challenge: bytesOf(challenge),
            timeout,
            attestationType: "none",
            excludeCredentials: exclude.map(({ credentialId, transports }) => ({
              id: credentialId,
              transports: [...transports],
            })),
            authenticatorSelection: {
              residentKey: "required",
              userVerification: "required",
            },
            supportedAlgorithmIDs: algorithms,
          }),
        );
        return {
          challenge: options.challenge,
          rp: { name: options.rp.name, id: relyingParty.id },
          user: options.user,
          pubKeyCredParams: options.pubKeyCredParams.map(({ alg }) => ({
            alg,
            type: "public-key" as const,
          })),
          timeout,
          attestation: "none" as const,
          excludeCredentials: (options.excludeCredentials ?? []).map(
            ({ id, transports }) => ({
              id,
              type: "public-key" as const,
              ...(transports === undefined ? {} : { transports }),
            }),
          ),
          authenticatorSelection: {
            residentKey: "required" as const,
            requireResidentKey: true,
            userVerification: "required" as const,
          },
          extensions: { credProps: true },
        };
      }),
    verifyCreation: ({ response, challenge, relyingParty }) =>
      Effect.gen(function* () {
        const verified = yield* unlessThrown(() =>
          verifyRegistrationResponse({
            response: {
              id: response.id,
              rawId: response.rawId,
              type: response.type,
              response: {
                clientDataJSON: response.response.clientDataJSON,
                attestationObject: response.response.attestationObject,
                ...(response.response.transports === undefined
                  ? {}
                  : { transports: [...response.response.transports] }),
              },
              clientExtensionResults: {},
            },
            expectedChallenge: challenge,
            expectedOrigin: relyingParty.origin,
            expectedRPID: relyingParty.id,
            requireUserVerification: true,
            supportedAlgorithmIDs: algorithms,
          }),
        );
        return Option.flatMap(verified, (result) => {
          if (!result.verified) return Option.none();
          const { credential } = result.registrationInfo;
          const made: Passkey.Credential = {
            credentialId: Passkey.CredentialId.make(credential.id),
            publicKey: credential.publicKey,
            counter: credential.counter,
            transports: credential.transports ?? [],
          };
          return Option.some(made);
        });
      }),
    requestOptions: ({ relyingParty, challenge }) =>
      Effect.gen(function* () {
        const options = yield* Effect.promise(() =>
          generateAuthenticationOptions({
            rpID: relyingParty.id,
            challenge: bytesOf(challenge),
            timeout,
            userVerification: "required",
          }),
        );
        return {
          challenge: options.challenge,
          rpId: relyingParty.id,
          timeout,
          userVerification: "required" as const,
        };
      }),
    verifySignIn: ({ response, challenge, passkey, relyingParty }) =>
      Effect.gen(function* () {
        const verified = yield* unlessThrown(() =>
          verifyAuthenticationResponse({
            response: {
              id: response.id,
              rawId: response.rawId,
              type: response.type,
              response: {
                clientDataJSON: response.response.clientDataJSON,
                authenticatorData: response.response.authenticatorData,
                signature: response.response.signature,
                ...(response.response.userHandle === undefined
                  ? {}
                  : { userHandle: response.response.userHandle }),
              },
              clientExtensionResults: {},
            },
            expectedChallenge: challenge,
            expectedOrigin: relyingParty.origin,
            expectedRPID: relyingParty.id,
            credential: {
              id: passkey.credentialId,
              publicKey: new Uint8Array(passkey.publicKey),
              counter: passkey.counter,
              transports: [...passkey.transports],
            },
            requireUserVerification: true,
          }),
        );
        return Option.flatMap(verified, ({ verified, authenticationInfo }) =>
          verified ? Option.some(authenticationInfo.newCounter) : Option.none(),
        );
      }),
    challengeOf: (clientDataJSON) =>
      Option.map(
        decodeClientData(
          Buffer.from(clientDataJSON, "base64url").toString("utf8"),
        ),
        ({ challenge }) => challenge,
      ),
  }),
);
