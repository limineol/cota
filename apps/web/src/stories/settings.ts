import {
  answer,
  asked,
  at,
  type Fixture,
  never,
  noContent,
  once,
  problem,
} from "./fake-api.ts";
import { owner } from "./fixtures.ts";
import { lastFifteenMinutes, now } from "./overview.ts";

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

const iso = (at: number) => new Date(at).toISOString();

type Names = Parameters<typeof answer<"display-names", "list">>[2]["names"];
type Name = Names[number];

/** Owner names, built-in names, a name whose id the request log has not seen, and keys with a slash and a percent sign. */
export const settingsNames: Names = [
  {
    kind: "client",
    key: "claude-code",
    name: "Claude Code",
    source: "built-in",
  },
  { kind: "client", key: "codex", name: "Codex", source: "built-in" },
  { kind: "client", key: "pi", name: "Pi", source: "built-in" },
  { kind: "machine", key: "desk", name: "Desk", source: "owner" },
  {
    kind: "model",
    key: "claude-haiku-4-5",
    name: "Claude Haiku 4.5",
    source: "built-in",
  },
  {
    kind: "model",
    key: "claude-opus-4-5",
    name: "Claude Opus 4.5",
    source: "built-in",
  },
  { kind: "model", key: "glm-4.6", name: "GLM", source: "owner" },
  {
    kind: "model",
    key: "gpt-5-codex",
    name: "GPT-5 Codex",
    source: "built-in",
  },
  {
    kind: "model",
    key: "retired-model",
    name: "The retired one",
    source: "owner",
  },
  { kind: "pool", key: "solo", name: "Solo plan", source: "owner" },
  { kind: "project", key: "notes", name: "Notes", source: "owner" },
];

const namesAnswer = (names: Names) =>
  answer("display-names", "list", { names });

/** The names, then, once a change is made, the names as the hub answers them after it. */
export const namesBeforeAndAfter = (after: Names): ReadonlyArray<Fixture> => [
  once(namesAnswer(settingsNames)),
  namesAnswer(after),
];

export const replaced = (
  kind: Name["kind"],
  key: string,
  next: Name | null,
): Names => {
  const rest = settingsNames.filter(
    (name) => !(name.kind === kind && name.key === key),
  );
  return next === null ? rest : [...rest, next];
};

const seen = (values: ReadonlyArray<readonly [string, number]>) =>
  values.map(([value, requests]) => ({ value, requests }));

/** Every id the fixtures' request log has, over all time. */
const facetsAnswer = answer("traffic", "facets", {
  pool: seen([
    ["solo", 4210],
    ["studio", 2880],
    ["codex", 1640],
    ["spare", 210],
    ["zai", 96],
    ["local", 12],
  ]),
  model: seen([
    ["claude-opus-4-5", 3150],
    ["gpt-5-codex", 1640],
    ["claude-haiku-4-5", 980],
    ["glm-4.6", 96],
    ["qwen3-coder", 12],
  ]),
  client: seen([
    ["claude-code", 5300],
    ["codex", 1640],
    ["pi", 120],
    ["opencode", 88],
  ]),
  machine: seen([
    ["desk", 6100],
    ["laptop", 920],
    ["rig%25", 128],
  ]),
  project: seen([
    ["acme/shop", 3020],
    ["notes", 2210],
    ["cota", 1790],
    ["blog", 128],
  ]),
  provider: seen([
    ["anthropic", 7340],
    ["openai", 1640],
    ["zai", 96],
  ]),
  hub_key: seen([["desk-key", 7148]]),
  outcome: seen([
    ["ok", 9010],
    ["error", 76],
  ]),
});

const noFacets = answer("traffic", "facets", {
  pool: [],
  model: [],
  client: [],
  machine: [],
  project: [],
  provider: [],
  hub_key: [],
  outcome: [],
});

const unavailable = {
  type: "urn:cota:request-log-unavailable",
  status: 503,
  detail: "ClickHouse did not answer within 30 seconds.",
} as const;

const loginKept = (
  provider: "anthropic" | "chatgpt",
  refreshed: number | null,
) =>
  ({
    provider,
    state: "active",
    givenAt: iso(now - 12 * day),
    refreshedAt: refreshed === null ? null : iso(now - refreshed),
    endsAt: iso(now + 5 * hour),
    expiredAt: null,
  }) as const;

const noLogin = (provider: "anthropic" | "chatgpt") =>
  ({
    provider,
    state: "none",
    givenAt: null,
    refreshedAt: null,
    endsAt: null,
    expiredAt: null,
  }) as const;

const pool = (
  id: string,
  shape: {
    readonly kind: "subscription" | "keyed" | "observed";
    readonly protocol:
      | "anthropic-messages"
      | "chatgpt-codex"
      | "openai-chat"
      | null;
    readonly provider: string;
    readonly plan: string | null;
    readonly quotaLogin:
      | ReturnType<typeof loginKept>
      | ReturnType<typeof noLogin>
      | typeof expiredLogin
      | null;
  },
) => ({
  id,
  ...shape,
  windows: [],
  observedAt: null,
  reading: null,
});

const expiredLogin = {
  provider: "anthropic",
  state: "expired",
  givenAt: iso(now - 40 * day),
  refreshedAt: iso(now - 9 * day),
  endsAt: iso(now - 9 * day + 8 * hour),
  expiredAt: iso(now - 9 * day + 8 * hour),
} as const;

const solo = pool("solo", {
  kind: "subscription",
  protocol: "anthropic-messages",
  provider: "anthropic",
  plan: "Max 5x",
  quotaLogin: loginKept("anthropic", 3 * hour),
});

/** Every state a quota login can be in, beside two keyed pools and an observed pool that take none. */
export const poolsOfEveryState = [
  solo,
  pool("studio", {
    kind: "subscription",
    protocol: "anthropic-messages",
    provider: "anthropic",
    plan: null,
    quotaLogin: noLogin("anthropic"),
  }),
  pool("codex", {
    kind: "subscription",
    protocol: "chatgpt-codex",
    provider: "openai",
    plan: null,
    quotaLogin: loginKept("chatgpt", null),
  }),
  pool("spare", {
    kind: "subscription",
    protocol: "anthropic-messages",
    provider: "anthropic",
    plan: null,
    quotaLogin: expiredLogin,
  }),
  pool("night", {
    kind: "subscription",
    protocol: "chatgpt-codex",
    provider: "openai",
    plan: null,
    quotaLogin: noLogin("chatgpt"),
  }),
  pool("zai", {
    kind: "keyed",
    protocol: "openai-chat",
    provider: "zai",
    plan: "Lite",
    quotaLogin: null,
  }),
  pool("local", {
    kind: "keyed",
    protocol: "openai-chat",
    provider: "lmstudio",
    plan: null,
    quotaLogin: null,
  }),
  pool("gemini", {
    kind: "observed",
    protocol: null,
    provider: "google",
    plan: null,
    quotaLogin: null,
  }),
];

const poolsAnswer = (pools: typeof poolsOfEveryState) =>
  answer("pools", "list", { pools });

type PasswordSource = "configuration" | "hub-store" | "none";

/** `GET /api/owner-password`: where the owner password is kept, set 6 days ago when the hub store keeps it. */
export const ownerPassword = (source: PasswordSource): Fixture =>
  answer("sign-in", "ownerPassword", {
    source,
    setAt: source === "hub-store" ? iso(now - 6 * day) : null,
  });

const passkey = (
  id: string,
  userAgent: string,
  origin: string,
  made: number,
  used: number | null,
) => ({
  id,
  userAgent,
  origin,
  createdAt: iso(now - made),
  lastUsedAt: used === null ? null : iso(now - used),
});

const chromeOnMacPasskey = passkey(
  "0193a4c2-5e00-7000-8000-0000000000a1",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "https://cota.example",
  2 * hour,
  null,
);

const safariOnIphonePasskey = passkey(
  "0193a4c2-5e00-7000-8000-0000000000a2",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  "https://cota.example",
  9 * day,
  3 * hour,
);

const firefoxOnWindowsPasskey = passkey(
  "0193a4c2-5e00-7000-8000-0000000000a3",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0",
  "http://localhost:4317",
  21 * day,
  15 * day,
);

/** Three passkeys made in three browsers, at two addresses, newest first as the hub lists them. */
export const threePasskeys = [
  chromeOnMacPasskey,
  safariOnIphonePasskey,
  firefoxOnWindowsPasskey,
];

type Passkeys = typeof threePasskeys;

export const passkeysAnswer = (passkeys: Passkeys): Fixture =>
  answer("sign-in", "passkeys", { passkeys });

const common = (names: ReadonlyArray<Fixture>): ReadonlyArray<Fixture> => [
  owner,
  ...names,
  lastFifteenMinutes(),
  facetsAnswer,
  poolsAnswer(poolsOfEveryState),
  ownerPassword("hub-store"),
  passkeysAnswer(threePasskeys),
];

/** A hub whose display names, pools and request log the screen reads. */
export const settings = (
  names: ReadonlyArray<Fixture> = [namesAnswer(settingsNames)],
  more: ReadonlyArray<Fixture> = [],
): ReadonlyArray<Fixture> => [...more, ...common(names)];

/** A display name set at one key's path, answered only when its body names `name`. */
export const setAt = (path: string, name: string, answered: Name): Fixture =>
  at(
    asked(answer("display-names", "set", answered), (body) =>
      typeof body === "object" && body !== null && "name" in body
        ? body.name === name
        : false,
    ),
    path,
  );

export const removedAt = (path: string): Fixture =>
  at(noContent("display-names", "remove"), path);

export const setRefused = (path: string): Fixture =>
  at(
    problem("display-names", "set", {
      type: "urn:cota:hub-store-unavailable",
      status: 503,
      detail: "The hub store could not be written: the disk is full.",
    }),
    path,
  );

/** A hub whose request log is empty and that has no names but the built-in ones. */
export const nothingSeen: ReadonlyArray<Fixture> = [
  owner,
  namesAnswer(settingsNames.filter((name) => name.source === "built-in")),
  lastFifteenMinutes(null),
  noFacets,
  poolsAnswer(poolsOfEveryState),
];

/** A hub that has not answered the request log yet. */
export const namesLoading: ReadonlyArray<Fixture> = [
  owner,
  namesAnswer(settingsNames),
  lastFifteenMinutes(),
  never("traffic", "facets"),
  poolsAnswer(poolsOfEveryState),
];

/** A hub whose request log cannot be read. */
export const namesFailed: ReadonlyArray<Fixture> = [
  owner,
  namesAnswer(settingsNames),
  lastFifteenMinutes(),
  problem("traffic", "facets", unavailable),
  poolsAnswer(poolsOfEveryState),
];

const signIn = (
  id: string,
  userAgent: string,
  made: number,
  used: number,
  current = false,
) => ({
  id,
  createdAt: iso(now - made),
  expiresAt: iso(now - made + 30 * day),
  lastUsedAt: iso(now - used),
  userAgent,
  current,
});

const thisBrowser = signIn(
  "0b6f3c1e-5d2a-4c8e-9f1a-2e7d4b9c6a30",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0",
  1 * day,
  0,
  true,
);

const chromeOnWindows = signIn(
  "0193a4c2-5e00-7000-8000-000000000002",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  2 * hour,
  14 * minute,
);

const safariOnIphone = signIn(
  "0193a4c2-5e00-7000-8000-000000000003",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  4 * day,
  3 * day,
);

const edgeOnAndroid = signIn(
  "0193a4c2-5e00-7000-8000-000000000004",
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 EdgA/131.0.2903.70",
  19 * day,
  6 * day,
);

/** Newest first, as the hub lists them, this browser among them. */
const fourSignIns = [
  chromeOnWindows,
  thisBrowser,
  safariOnIphone,
  edgeOnAndroid,
];

const signInsAnswer = (signIns: typeof fourSignIns) =>
  answer("sign-in", "signIns", { signIns });

export const signIns: ReadonlyArray<Fixture> = settings(undefined, [
  signInsAnswer(fourSignIns),
]);

export const onlyThisBrowser: ReadonlyArray<Fixture> = settings(undefined, [
  signInsAnswer([thisBrowser]),
]);

/** Chrome on Windows is ended at its own path, and the list after it is read without it. */
export const endingOne: ReadonlyArray<Fixture> = settings(undefined, [
  at(
    noContent("sign-in", "revokeSignIn"),
    `/api/sign-ins/${chromeOnWindows.id}`,
  ),
  once(signInsAnswer(fourSignIns)),
  signInsAnswer([thisBrowser, safariOnIphone, edgeOnAndroid]),
]);

export const endingTheOthers: ReadonlyArray<Fixture> = settings(undefined, [
  answer("sign-in", "revokeOtherSignIns", { revoked: 3 }),
  once(signInsAnswer(fourSignIns)),
  signInsAnswer([thisBrowser]),
]);

export const signInsLoading: ReadonlyArray<Fixture> = settings(undefined, [
  never("sign-in", "signIns"),
]);

export const signInsFailed: ReadonlyArray<Fixture> = settings(undefined, [
  problem("sign-in", "signIns", {
    type: "urn:cota:hub-store-unavailable",
    status: 503,
    detail: "The hub store could not be read.",
  }),
]);

/** The quota logins of every state. */
export const quotaLogins: ReadonlyArray<Fixture> = settings();

/** Solo's quota login is forgotten at its own path, and the pools after it are read with none. */
export const forgettingOne: ReadonlyArray<Fixture> = [
  owner,
  namesAnswer(settingsNames),
  at(noContent("pools", "forget"), "/api/pools/solo/quota-login"),
  once(poolsAnswer(poolsOfEveryState)),
  poolsAnswer(
    poolsOfEveryState.map((each) =>
      each.id === "solo" ? { ...each, quotaLogin: noLogin("anthropic") } : each,
    ),
  ),
];

export const keyedOnly: ReadonlyArray<Fixture> = [
  owner,
  namesAnswer(settingsNames),
  poolsAnswer(poolsOfEveryState.filter((each) => each.kind === "keyed")),
];

export const poolsLoading: ReadonlyArray<Fixture> = [
  owner,
  namesAnswer(settingsNames),
  never("pools", "list"),
];

export const poolsFailed: ReadonlyArray<Fixture> = [
  owner,
  namesAnswer(settingsNames),
  problem("pools", "list", {
    type: "urn:cota:hub-store-unavailable",
    status: 503,
    detail: "The hub store could not be read.",
  }),
];

/** The Sign-ins part of a hub whose password is kept as `source` and that keeps `passkeys`, before the rest of `more`. */
export const waysIn = (
  source: PasswordSource,
  passkeys: Passkeys,
  more: ReadonlyArray<Fixture> = [],
): ReadonlyArray<Fixture> =>
  settings(undefined, [
    ...more,
    ownerPassword(source),
    passkeysAnswer(passkeys),
    signInsAnswer(fourSignIns),
  ]);

/** The password is changed with `current`, every other sign-in ended, and the ways in read again. */
export const changing = (current: string): ReadonlyArray<Fixture> =>
  waysIn("hub-store", threePasskeys, [
    asked(noContent("sign-in", "changeOwnerPassword"), (body) =>
      typeof body === "object" && body !== null && "current" in body
        ? body.current === current
        : false,
    ),
    problem("sign-in", "changeOwnerPassword", {
      type: "urn:cota:wrong-password",
      status: 401,
    }),
    once(signInsAnswer(fourSignIns)),
    signInsAnswer([thisBrowser]),
  ]);

export const changePaused: ReadonlyArray<Fixture> = waysIn(
  "hub-store",
  threePasskeys,
  [
    problem(
      "sign-in",
      "changeOwnerPassword",
      {
        type: "urn:cota:too-many-attempts",
        status: 429,
        detail: "Signing in is paused for 420 seconds.",
      },
      { "retry-after": "420" },
    ),
  ],
);

/** The password is set, with no current one, on a hub where it was off. */
export const settingOne: ReadonlyArray<Fixture> = settings(undefined, [
  asked(
    noContent("sign-in", "changeOwnerPassword"),
    (body) => typeof body === "object" && body !== null && !("current" in body),
  ),
  once(ownerPassword("none")),
  ownerPassword("hub-store"),
  passkeysAnswer(threePasskeys),
  once(signInsAnswer(fourSignIns)),
  signInsAnswer([thisBrowser]),
]);

/** The password is turned off, and is then read as off. */
export const turningOff: ReadonlyArray<Fixture> = settings(undefined, [
  noContent("sign-in", "forgetOwnerPassword"),
  once(ownerPassword("hub-store")),
  ownerPassword("none"),
  passkeysAnswer(threePasskeys),
  signInsAnswer(fourSignIns),
]);

/** The password is turned off from here while another browser removed the last passkey. */
export const turnedOffElsewhere: ReadonlyArray<Fixture> = settings(undefined, [
  problem("sign-in", "forgetOwnerPassword", {
    type: "urn:cota:last-way-in",
    status: 409,
  }),
  ownerPassword("hub-store"),
  once(passkeysAnswer(threePasskeys.slice(0, 1))),
  passkeysAnswer([]),
  signInsAnswer(fourSignIns),
]);

export const waysInLoading: ReadonlyArray<Fixture> = settings(undefined, [
  never("sign-in", "ownerPassword"),
  never("sign-in", "passkeys"),
  never("sign-in", "signIns"),
]);

export const waysInFailed: ReadonlyArray<Fixture> = settings(undefined, [
  problem("sign-in", "ownerPassword", {
    type: "urn:cota:hub-store-unavailable",
    status: 503,
    detail: "The hub store could not be read.",
  }),
  problem("sign-in", "passkeys", {
    type: "urn:cota:hub-store-unavailable",
    status: 503,
    detail: "The hub store could not be read.",
  }),
  signInsAnswer(fourSignIns),
]);

/** `POST /api/passkeys/options` at `https://cota.example`, as the hub writes the options. */
export const creationOptions: Fixture = answer("sign-in", "preparePasskey", {
  challenge: "3q2-7wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  rp: { name: "Cota", id: "cota.example" },
  user: { id: "Y290YS1vd25lcg", name: "owner", displayName: "Cota owner" },
  pubKeyCredParams: [
    { alg: -8, type: "public-key" },
    { alg: -7, type: "public-key" },
    { alg: -257, type: "public-key" },
  ],
  timeout: 300000,
  attestation: "none",
  excludeCredentials: [],
  authenticatorSelection: {
    residentKey: "required",
    requireResidentKey: true,
    userVerification: "required",
  },
  extensions: { credProps: true },
});

const madeHere = passkey(
  "0193a4c2-5e00-7000-8000-0000000000a4",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0",
  "https://cota.example",
  0,
  null,
);

/** A passkey is made from the stand-in's answer, and the list is read again with it first. */
export const addingOne = (answerId: string): ReadonlyArray<Fixture> =>
  waysIn("hub-store", threePasskeys, [
    creationOptions,
    asked(answer("sign-in", "makePasskey", madeHere), (body) =>
      typeof body === "object" && body !== null && "id" in body
        ? body.id === answerId
        : false,
    ),
    once(passkeysAnswer(threePasskeys)),
    passkeysAnswer([madeHere, ...threePasskeys]),
  ]);

export const addingRefused: ReadonlyArray<Fixture> = waysIn(
  "hub-store",
  threePasskeys,
  [
    creationOptions,
    problem("sign-in", "makePasskey", {
      type: "urn:cota:passkey-not-made",
      status: 400,
    }),
  ],
);

/** The hub answers that the page's origin has no relying party. */
export const addingAtNoPasskeyOrigin: ReadonlyArray<Fixture> = waysIn(
  "hub-store",
  threePasskeys,
  [
    problem("sign-in", "preparePasskey", {
      type: "urn:cota:not-a-passkey-origin",
      status: 400,
      detail:
        "http://127.0.0.1:18080 is not https at a host name, nor localhost.",
    }),
  ],
);

/** The newest passkey is removed at its own path, and the list is read again without it. */
export const removingOne: ReadonlyArray<Fixture> = waysIn(
  "hub-store",
  threePasskeys,
  [
    at(
      noContent("sign-in", "removePasskey"),
      `/api/passkeys/${chromeOnMacPasskey.id}`,
    ),
    once(passkeysAnswer(threePasskeys)),
    passkeysAnswer(threePasskeys.slice(1)),
  ],
);

/** One passkey and no password: it is the last way in. */
export const lastPasskey: ReadonlyArray<Fixture> = waysIn(
  "none",
  threePasskeys.slice(0, 1),
);

/** Two passkeys and no password; another browser removes one while this one removes the other. */
export const removedElsewhere: ReadonlyArray<Fixture> = settings(undefined, [
  problem("sign-in", "removePasskey", {
    type: "urn:cota:last-way-in",
    status: 409,
  }),
  ownerPassword("none"),
  once(passkeysAnswer([safariOnIphonePasskey, firefoxOnWindowsPasskey])),
  passkeysAnswer([firefoxOnWindowsPasskey]),
  signInsAnswer(fourSignIns),
]);
