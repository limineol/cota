import type { Api } from "@cota/hub/api";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  WebAuthnError,
} from "@simplewebauthn/browser";
import type { HttpApiEndpoint } from "effect/http-api";
import { createContext, use } from "react";
import type { Client } from "./api.ts";

type SignInGroup = Client["sign-in"];
type Endpoints = (typeof Api.groups)["sign-in"]["endpoints"];

/** What `POST /api/passkeys/options` answers: the options a passkey is made with. */
export type CreationOptions = HttpApiEndpoint.Success<
  Endpoints["preparePasskey"]
>["Type"];

/** What `POST /api/sign-in/passkey/options` answers: the options a passkey signs in with. */
export type RequestOptions = HttpApiEndpoint.Success<
  Endpoints["preparePasskeySignIn"]
>["Type"];

export type CreationResponse = Parameters<
  SignInGroup["makePasskey"]
>[0]["payload"];

export type SignInResponse = Parameters<
  SignInGroup["signInWithPasskey"]
>[0]["payload"];

/**
 * How a ceremony in the browser ended: with its answer for the hub; the
 * owner closed the browser's prompt or let it time out; this device holds a
 * passkey for the hub already; this address cannot have a passkey; or the
 * browser failed in a way of its own, in its words.
 */
export type Ceremony<A> =
  | { readonly _tag: "Answered"; readonly answer: A }
  | { readonly _tag: "Cancelled" }
  | { readonly _tag: "Exists" }
  | { readonly _tag: "NotHere" }
  | { readonly _tag: "Failed"; readonly message: string };

/** The browser's side of passkeys: whether it offers them at this page's address, and its two ceremonies. */
export interface Passkeys {
  /** This page's origin, as the browser writes it: what a passkey would be made at. */
  readonly address: string;
  readonly offered: boolean;
  readonly make: (
    options: CreationOptions,
  ) => Promise<Ceremony<CreationResponse>>;
  readonly signIn: (
    options: RequestOptions,
  ) => Promise<Ceremony<SignInResponse>>;
}

const ipAddress = /^(?:\d+\.\d+\.\d+\.\d+|\[.*\])$/;

/** Whether a browser offers a passkey at an address: `https` at a host name, or `localhost` (`docs/specs/sign-in/spec.md`, Relying party). */
const offersAt = (url: URL) => {
  const host = url.hostname.toLowerCase();
  if (host === "localhost") return true;
  return url.protocol === "https:" && !ipAddress.test(host);
};

/** What the browser's refusal means, decided once for both ceremonies. */
const refusalOf = (error: unknown): Ceremony<never> => {
  if (error instanceof WebAuthnError) {
    switch (error.code) {
      case "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED":
        return { _tag: "Exists" };
      case "ERROR_INVALID_DOMAIN":
      case "ERROR_INVALID_RP_ID":
        return { _tag: "NotHere" };
      case "ERROR_CEREMONY_ABORTED":
        return { _tag: "Cancelled" };
      case "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY":
        // Browsers answer NotAllowedError when the owner closes the prompt,
        // when it times out, and for little else they will say.
        return error.cause instanceof Error &&
          error.cause.name === "NotAllowedError"
          ? { _tag: "Cancelled" }
          : { _tag: "Failed", message: error.message };
      default:
        return { _tag: "Failed", message: error.message };
    }
  }
  if (error instanceof Error && error.name === "NotAllowedError") {
    return { _tag: "Cancelled" };
  }
  return {
    _tag: "Failed",
    message: error instanceof Error ? error.message : String(error),
  };
};

const browserPasskeys = (): Passkeys => {
  const address = globalThis.location?.origin ?? "";
  return {
    address,
    offered:
      browserSupportsWebAuthn() &&
      globalThis.location !== undefined &&
      offersAt(new URL(globalThis.location.href)),
    make: async (options) => {
      try {
        const made = await startRegistration({
          optionsJSON: {
            ...options,
            rp: { ...options.rp },
            user: { ...options.user },
            pubKeyCredParams: options.pubKeyCredParams.map((each) => ({
              ...each,
            })),
            excludeCredentials: options.excludeCredentials.map(
              ({ id, type }) => ({ id, type }),
            ),
            authenticatorSelection: { ...options.authenticatorSelection },
            extensions: { ...options.extensions },
          },
        });
        return {
          _tag: "Answered",
          answer: {
            id: made.id,
            rawId: made.rawId,
            type: "public-key",
            response: {
              clientDataJSON: made.response.clientDataJSON,
              attestationObject: made.response.attestationObject,
              ...(made.response.transports === undefined
                ? {}
                : { transports: made.response.transports }),
            },
          },
        };
      } catch (error) {
        return refusalOf(error);
      }
    },
    signIn: async (options) => {
      try {
        const signed = await startAuthentication({
          optionsJSON: { ...options },
        });
        return {
          _tag: "Answered",
          answer: {
            id: signed.id,
            rawId: signed.rawId,
            type: "public-key",
            response: {
              clientDataJSON: signed.response.clientDataJSON,
              authenticatorData: signed.response.authenticatorData,
              signature: signed.response.signature,
              ...(signed.response.userHandle === undefined
                ? {}
                : { userHandle: signed.response.userHandle }),
            },
          },
        };
      } catch (error) {
        return refusalOf(error);
      }
    },
  };
};

/** The passkeys of this browser; stories give a stand-in, so no story needs an authenticator. */
export const PasskeysOfTheBrowser = createContext<Passkeys>(browserPasskeys());

export const usePasskeys = () => use(PasskeysOfTheBrowser);
