/** A fact a right answer holds, as the spellings that count for it. */
export type Fact = ReadonlyArray<string>;

/** A question of the owner's about the world's request log (`docs/specs/memory-evals/spec.md`, The questions). */
export interface Question {
  readonly id: string;
  /** How its answer is found, for the report. */
  readonly foundBy: string;
  readonly asked: string;
  /** The facts a right answer holds; none for a question the log has no answer to. */
  readonly facts: ReadonlyArray<Fact>;
}

export const questions: ReadonlyArray<Question> = [
  {
    id: "webhook-retries",
    foundBy: "search",
    asked:
      "How many attempts did we settle on for the webhook sender's retries, and in which project was that?",
    facts: [
      ["max_attempts = 6", "max_attempts=6", "6 attempts", "six attempts"],
      ["acme/billing"],
    ],
  },
  {
    id: "bpe-title",
    foundBy: "SQL, then a transcript",
    asked:
      'In my session titled "Faster BPE merges", what time did the benchmark reach in the end?',
    facts: [["16.8 ms", "16.8ms"]],
  },
  {
    id: "tokenizer-week",
    foundBy: "SQL",
    asked:
      "How many sessions did I have in lab/tokenizer in the week of Monday 19 October 2026, and on which machines?",
    facts: [["3 sessions", "three sessions"], ["buildbox"], ["studio"]],
  },
  {
    id: "costliest-project",
    foundBy: "SQL",
    asked: "Which project cost the most in October 2026?",
    facts: [["acme/storefront"]],
  },
  {
    id: "flaky-test",
    foundBy: "search, then a transcript",
    asked:
      "Which checkout test in acme/storefront was flaky, and in which function did it fail?",
    facts: [["cart total rounds to the cent"], ["roundToCent"]],
  },
  {
    id: "buildbox-day",
    foundBy: "the sessions list's filters",
    asked: "What was I working on, on buildbox, on 27 October 2026?",
    facts: [["toolchain", "bun 1.4.2"]],
  },
  {
    id: "deploy-secret",
    foundBy: "search, then a transcript",
    asked:
      "Why did the billing deploy fail on 27 October 2026, and what is the value of the variable it needed?",
    facts: [["STRIPE_WEBHOOK_SECRET"]],
  },
  {
    id: "kubernetes",
    foundBy: "nothing: it is not in the log",
    asked: "When did I set up Kubernetes for acme/billing?",
    facts: [],
  },
  {
    id: "redis-eviction",
    foundBy: "nothing: a Redis session is there, but not this",
    asked:
      "What eviction policy did I choose for the Redis cache in my notes project?",
    facts: [],
  },
];
