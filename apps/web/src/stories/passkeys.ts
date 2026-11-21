import type {
  Ceremony,
  CreationResponse,
  Passkeys,
  SignInResponse,
} from "#shared/passkeys.ts";

/** The answer the stand-in's authenticator gives when a passkey is made. */
export const madeAnswer: CreationResponse = {
  id: "c3RhbmQtaW4tcGFzc2tleQ",
  rawId: "c3RhbmQtaW4tcGFzc2tleQ",
  type: "public-key",
  response: {
    clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0",
    attestationObject: "o2NmbXRkbm9uZWdhdHRTdG10oA",
    transports: ["internal", "hybrid"],
  },
};

/** The answer the stand-in's authenticator gives when it signs in. */
export const signedAnswer: SignInResponse = {
  id: "c3RhbmQtaW4tcGFzc2tleQ",
  rawId: "c3RhbmQtaW4tcGFzc2tleQ",
  type: "public-key",
  response: {
    clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0",
    authenticatorData: "SZYN5YgOjGh0NBcPZHZgW4_krrmihjLHmVzzuoMdl2MdAAAAAA",
    signature: "MEUCIQDstand-in-signature",
    userHandle: "Y290YS1vd25lcg",
  },
};

type Outcome =
  | "answers"
  | "waits"
  | "Cancelled"
  | "Exists"
  | "NotHere"
  | "Failed";

const ceremony = <A>(outcome: Outcome, answer: A): Promise<Ceremony<A>> => {
  switch (outcome) {
    case "answers":
      return Promise.resolve({ _tag: "Answered", answer });
    case "waits":
      return new Promise(() => {});
    case "Failed":
      return Promise.resolve({
        _tag: "Failed",
        message: "The authenticator could not be reached.",
      });
    case "Cancelled":
    case "Exists":
    case "NotHere":
      return Promise.resolve({ _tag: outcome });
  }
};

/**
 * A browser that stands in for a real one with an authenticator: it offers
 * passkeys or not, at the address given, and each ceremony answers, waits
 * for ever, or ends as the story says.
 */
export const standIn = ({
  offered = true,
  address = "https://cota.example",
  make = "answers",
  signIn = "answers",
}: {
  readonly offered?: boolean;
  readonly address?: string;
  readonly make?: Outcome;
  readonly signIn?: Outcome;
} = {}): Passkeys => ({
  address,
  offered,
  make: () => ceremony(make, madeAnswer),
  signIn: () => ceremony(signIn, signedAnswer),
});
