import { Effect } from "effect";
import type {
  CreationResponse,
  SignInResponse,
} from "#modules/sign-in/03-domain/ceremony.ts";

/** A passkey the authenticator holds: an ES256 key pair, made with WebCrypto, and its credential id. */
export interface Key {
  readonly credentialId: string;
  readonly keys: CryptoKeyPair;
  /** The private key's scalar as JWK writes it, which no store may hold. */
  readonly secret: string;
  readonly x: Uint8Array;
  readonly y: Uint8Array;
}

/** What the authenticator says and signs, as a browser and an authenticator would, or not, for a test. */
export interface Signing {
  readonly origin: string;
  readonly rpId: string;
  readonly userVerified: boolean;
  readonly counter: number;
}

type Cbor = number | string | Uint8Array | Map<Cbor, Cbor>;

const head = (major: number, length: number): ReadonlyArray<number> => {
  if (length < 24) return [(major << 5) | length];
  if (length < 0x100) return [(major << 5) | 24, length];
  if (length < 0x10000) return [(major << 5) | 25, length >> 8, length & 0xff];
  return [
    (major << 5) | 26,
    (length >>> 24) & 0xff,
    (length >> 16) & 0xff,
    (length >> 8) & 0xff,
    length & 0xff,
  ];
};

/** The few CBOR major types WebAuthn's attestation object and COSE keys use: integers, text, bytes and maps. */
const cbor = (value: Cbor): Uint8Array => {
  if (typeof value === "number") {
    return new Uint8Array(value >= 0 ? head(0, value) : head(1, -1 - value));
  }
  if (typeof value === "string") {
    const text = new TextEncoder().encode(value);
    return Buffer.concat([new Uint8Array(head(3, text.length)), text]);
  }
  if (value instanceof Uint8Array) {
    return Buffer.concat([new Uint8Array(head(2, value.length)), value]);
  }
  return Buffer.concat([
    new Uint8Array(head(5, value.size)),
    ...[...value].flatMap(([key, each]) => [cbor(key), cbor(each)]),
  ]);
};

const base64Url = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString("base64url");

const sha256 = (bytes: Uint8Array): Uint8Array =>
  new Bun.CryptoHasher("sha256").update(bytes).digest();

const uint32 = (value: number): Uint8Array => {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value);
  return bytes;
};

const flags = (signing: Signing, attested: boolean): Uint8Array =>
  new Uint8Array([
    0x01 | (signing.userVerified ? 0x04 : 0) | (attested ? 0x40 : 0),
  ]);

const clientData = (type: string, challenge: string, origin: string) =>
  new TextEncoder().encode(
    JSON.stringify({ type, challenge, origin, crossOrigin: false }),
  );

/** An ECDSA integer as DER writes it: no leading zeros, and one when its high bit is set. */
const derInteger = (raw: Uint8Array): Uint8Array => {
  let start = 0;
  while (start < raw.length - 1 && raw[start] === 0) start += 1;
  const trimmed = raw.slice(start);
  const value =
    (trimmed[0] ?? 0) >= 0x80
      ? Buffer.concat([new Uint8Array([0]), trimmed])
      : trimmed;
  return Buffer.concat([new Uint8Array([0x02, value.length]), value]);
};

/** WebCrypto signs ECDSA as r and s side by side; WebAuthn's ES256 is their DER sequence. */
const der = (signature: Uint8Array): Uint8Array => {
  const r = derInteger(signature.slice(0, 32));
  const s = derInteger(signature.slice(32));
  return Buffer.concat([new Uint8Array([0x30, r.length + s.length]), r, s]);
};

/** A new passkey: an ES256 key pair and 16 random bytes as its credential id. */
export const makeKey = Effect.promise(async (): Promise<Key> => {
  const keys = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", keys.privateKey);
  return {
    credentialId: base64Url(crypto.getRandomValues(new Uint8Array(16))),
    keys,
    secret: jwk.d ?? "",
    x: new Uint8Array(Buffer.from(jwk.x ?? "", "base64url")),
    y: new Uint8Array(Buffer.from(jwk.y ?? "", "base64url")),
  };
});

/** The key's public half as COSE writes it: an EC2 key on P-256, for ES256. */
const coseOf = (key: Key): Uint8Array =>
  cbor(
    new Map<Cbor, Cbor>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, key.x],
      [-3, key.y],
    ]),
  );

/**
 * What a browser sends after an authenticator made the key as a passkey for
 * the creation options' challenge: client data of `webauthn.create` at the
 * origin given, and an attestation of format none whose authenticator data
 * is for the RP ID given, with the flags and counter given.
 */
export const create = (
  key: Key,
  challenge: string,
  signing: Signing,
): CreationResponse => {
  const id = new Uint8Array(Buffer.from(key.credentialId, "base64url"));
  const authData = Buffer.concat([
    sha256(new TextEncoder().encode(signing.rpId)),
    flags(signing, true),
    uint32(signing.counter),
    new Uint8Array(16),
    new Uint8Array([id.length >> 8, id.length & 0xff]),
    id,
    coseOf(key),
  ]);
  return {
    id: key.credentialId,
    rawId: key.credentialId,
    type: "public-key",
    response: {
      clientDataJSON: base64Url(
        clientData("webauthn.create", challenge, signing.origin),
      ),
      attestationObject: base64Url(
        cbor(
          new Map<Cbor, Cbor>([
            ["fmt", "none"],
            ["attStmt", new Map()],
            ["authData", new Uint8Array(authData)],
          ]),
        ),
      ),
      transports: ["internal", "hybrid"],
    },
  };
};

/**
 * What a browser sends after an authenticator signed the request options'
 * challenge with the given signer's private key, for the credential id
 * given: client data of `webauthn.get` at the origin given, and
 * authenticator data for the RP ID given, with the flags and counter given.
 */
export const get = (input: {
  readonly credentialId: string;
  readonly signer: Key;
  readonly challenge: string;
  readonly signing: Signing;
}) =>
  Effect.promise(async (): Promise<SignInResponse> => {
    const { signing } = input;
    const authData = Buffer.concat([
      sha256(new TextEncoder().encode(signing.rpId)),
      flags(signing, false),
      uint32(signing.counter),
    ]);
    const data = clientData("webauthn.get", input.challenge, signing.origin);
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      input.signer.keys.privateKey,
      Buffer.concat([authData, sha256(data)]),
    );
    return {
      id: input.credentialId,
      rawId: input.credentialId,
      type: "public-key",
      response: {
        clientDataJSON: base64Url(data),
        authenticatorData: base64Url(authData),
        signature: base64Url(der(new Uint8Array(signature))),
        userHandle: base64Url(new TextEncoder().encode("cota-owner")),
      },
    };
  });
