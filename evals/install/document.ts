/** A fenced block or a quote of the install prompt, named by its section and its place there. */
export interface Block {
  readonly key: string;
  readonly section: string;
  readonly index: number;
  readonly kind: "sh" | "toml" | "text" | "quote";
  readonly text: string;
}

const kinds = ["sh", "toml", "text"] as const;

const kindOf = (info: string): Block["kind"] => {
  const kind = kinds.find((each) => each === info.trim());
  if (kind === undefined) {
    throw new Error(
      `The install prompt has a fenced block of "${info.trim()}", which the rehearsal does not read: give it one of ${kinds.join(", ")}.`,
    );
  }
  return kind;
};

/** Every fenced block and quote of a document, in order, each named `<h2> › <h3> #<n>`. */
export const blocksOf = (markdown: string): ReadonlyArray<Block> => {
  const blocks: Array<Block> = [];
  let h2 = "";
  let h3 = "";
  let fence: { kind: Block["kind"]; lines: Array<string> } | undefined;
  let quote: Array<string> | undefined;
  const counts = new Map<string, number>();
  const push = (kind: Block["kind"], text: string) => {
    const section = h3 === "" ? h2 : `${h2} › ${h3}`;
    const index = (counts.get(section) ?? 0) + 1;
    counts.set(section, index);
    blocks.push({ key: `${section} #${index}`, section, index, kind, text });
  };
  for (const line of markdown.split("\n")) {
    if (fence !== undefined) {
      if (line.startsWith("```")) {
        push(fence.kind, fence.lines.join("\n"));
        fence = undefined;
      } else {
        fence.lines.push(line);
      }
      continue;
    }
    if (quote !== undefined && !line.startsWith(">")) {
      push("quote", quote.join("\n"));
      quote = undefined;
    }
    if (line.startsWith("```")) {
      fence = { kind: kindOf(line.slice(3)), lines: [] };
    } else if (line.startsWith(">")) {
      quote = [...(quote ?? []), line.replace(/^> ?/, "")];
    } else if (line.startsWith("## ")) {
      h2 = line.slice(3).trim();
      h3 = "";
    } else if (line.startsWith("### ")) {
      h3 = line.slice(4).trim();
    }
  }
  if (fence !== undefined)
    throw new Error("The install prompt ends inside a fenced block.");
  if (quote !== undefined) push("quote", quote.join("\n"));
  return blocks;
};

/** The text of a section, `<h2>` or `<h2> › <h3>`, up to the next heading of its level or above. */
export const sectionOf = (markdown: string, section: string): string => {
  const [h2, h3] = section.split(" › ");
  const lines = markdown.split("\n");
  const start = lines.findIndex((line, at) =>
    h3 === undefined
      ? line === `## ${h2}`
      : line === `### ${h3}` &&
        lines.slice(0, at).findLast((each) => each.startsWith("## ")) ===
          `## ${h2}`,
  );
  if (start === -1)
    throw new Error(`The install prompt has no section ${section}.`);
  const level = h3 === undefined ? /^#{1,2} / : /^#{1,3} /;
  const end = lines.findIndex((line, at) => at > start && level.test(line));
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .join("\n")
    .trim();
};

/** What of a document the rehearsal does not know, and what it knows that the document lacks. */
export const unmatchedOf = (
  blocks: ReadonlyArray<Block>,
  known: ReadonlyArray<string>,
): {
  readonly unknown: ReadonlyArray<Block>;
  readonly missing: ReadonlyArray<string>;
} => ({
  unknown: blocks.filter(({ key }) => !known.includes(key)),
  missing: known.filter((key) => !blocks.some((block) => block.key === key)),
});

/** A replacement the rehearsal makes in a block's text: every `from` becomes `to`, and there must be one. */
export interface Change {
  readonly from: string;
  readonly to: string;
}

/** The text with each change made, or the change that no longer applies. */
export const changed = (block: Block, changes: ReadonlyArray<Change>): string =>
  changes.reduce((text, { from, to }) => {
    if (!text.includes(from)) {
      throw new Error(
        `The rehearsal's change of ${JSON.stringify(from)} no longer applies to ${block.key}. Update evals/install/rehearsal.ts.`,
      );
    }
    return text.replaceAll(from, to);
  }, block.text);
