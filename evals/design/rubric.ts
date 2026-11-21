export interface Rule {
  readonly id: string;
  readonly scope: string;
  readonly heldBy: string;
  readonly text: string;
  readonly bad: string;
  readonly good: string;
  readonly heldByLint: boolean;
}

const section = (design: string): string => {
  const start = design.indexOf("\n## Do's and Don'ts\n");
  if (start === -1) throw new Error("DESIGN.md has no Do's and Don'ts.");
  const rest = design.slice(start + 1);
  const next = rest.indexOf("\n## ", 1);
  return next === -1 ? rest : rest.slice(0, next);
};

const ruleOf = (id: string, body: string): Rule => {
  const facts = body.match(/^\*\*Scope:\*\* (.+?) \*\*Held by:\*\* (.+?)\n/m);
  const bad = body.indexOf("**Bad:**");
  const good = body.indexOf("**Good:**");
  if (facts === null || bad === -1 || good < bad) {
    throw new Error(
      `DESIGN.md's rule ${id} lacks its scope, its holder, or its Bad and Good pair.`,
    );
  }
  const heldBy = facts[2] ?? "";
  return {
    id,
    scope: facts[1] ?? "",
    heldBy,
    text: body
      .slice(facts.index ?? 0, bad)
      .replace(facts[0], "")
      .trim(),
    bad: body.slice(bad + "**Bad:**".length, good).trim(),
    good: body.slice(good + "**Good:**".length).trim(),
    heldByLint: /lint:design|shadcn\//.test(heldBy),
  };
};

/** Every rule of DESIGN.md's Do's and Don'ts, in the document's order, with its Bad and Good pair. */
export const rulesOf = (design: string): ReadonlyArray<Rule> =>
  section(design)
    .split(/^### /m)
    .slice(1)
    .map((part) => {
      const id = part.match(/^`([a-z0-9-]+)`\n/)?.[1];
      if (id === undefined) {
        throw new Error(
          `DESIGN.md has a rule without an id: ${part.slice(0, 60)}`,
        );
      }
      return ruleOf(id, part.slice(part.indexOf("\n") + 1));
    });
