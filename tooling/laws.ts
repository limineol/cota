export const tiers = [
  "types",
  "property",
  "replay",
  "contract",
  "clickhouse",
  "slow",
  "proof",
  "agreement",
] as const;
export type Tier = (typeof tiers)[number];

export interface Row {
  readonly id: string;
  readonly sentence: string;
  readonly claims: ReadonlyArray<string>;
}

export interface TestOutcome {
  readonly file: string;
  readonly title: string;
  readonly status: string;
}

const lawRow = /^\| ([A-Z]\d+) \| \*\*.+?\*\* (.+?) \| (.+?) \|$/;

export const rowsOf = (spec: string): ReadonlyArray<Row> =>
  spec.split("\n").flatMap((line) => {
    const [, id, sentence, heldBy] = line.match(lawRow) ?? [];
    if (id === undefined || sentence === undefined || heldBy === undefined) {
      return [];
    }
    return [
      { id, sentence, claims: heldBy.split(",").map((tier) => tier.trim()) },
    ];
  });

export const isTier = (name: string): name is Tier =>
  tiers.some((tier) => tier === name);

export type TestTier =
  | "property"
  | "replay"
  | "contract"
  | "clickhouse"
  | "slow";

/**
 * A test's tier, from its file: `replay.test.ts` or `*.replay.test.ts`
 * replays exchanges, `*.contract.test.ts` calls the API of a running hub,
 * `*.clickhouse.test.ts` runs against a real ClickHouse, `*.slow.test.ts` needs
 * Docker or minutes (the slow tier, verify's `evals` gate), and any other is a
 * property test.
 */
export const tierOf = (file: string): TestTier => {
  if (/(?:^|[/.])replay\.test\.ts$/.test(file)) return "replay";
  if (file.endsWith(".contract.test.ts")) return "contract";
  if (file.endsWith(".clickhouse.test.ts")) return "clickhouse";
  if (file.endsWith(".slow.test.ts")) return "slow";
  return "property";
};

/** The tests titled `<id>: …` that hold a law at a test tier. */
export const testsOf = (
  id: string,
  tier: TestTier,
  outcomes: ReadonlyArray<TestOutcome>,
): ReadonlyArray<TestOutcome> =>
  outcomes.filter(
    ({ file, title }) => title.startsWith(`${id}: `) && tierOf(file) === tier,
  );

export const statusOf = (
  outcomes: ReadonlyArray<TestOutcome>,
): string | undefined => {
  if (outcomes.length === 0) return undefined;
  const all = outcomes.every(({ status }) => status === "passed");
  return `${all ? "passed" : "failed"}, ${outcomes.length} ${outcomes.length === 1 ? "test" : "tests"}`;
};

/**
 * What is wrong with a law's evidence: a tier its spec names that verify does
 * not know, and a tier it claims that did not run or did not pass.
 */
export const problemsOf = (
  row: Row,
  ran: Readonly<Partial<Record<Tier, string>>>,
): ReadonlyArray<string> =>
  row.claims.flatMap((claim) => {
    if (!isTier(claim)) {
      return [
        `${row.id} is held by "${claim}", which is not a tier (${tiers.join(", ")})`,
      ];
    }
    const status = ran[claim];
    if (status === undefined) {
      return [`${row.id} has no ${claim} tier, though its spec says so`];
    }
    if (status.startsWith("failed")) {
      return [`${row.id}'s ${claim} tier failed: ${status}`];
    }
    return [];
  });
