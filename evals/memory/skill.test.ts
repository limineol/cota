import { describe, expect, it } from "vitest";
import { blocksOf } from "../install/document.ts";
import { skillText } from "./evaluation.ts";
import { questions } from "./questions.ts";
import {
  commandOf,
  examples,
  knownBlocks,
  pageOf,
  plannedQuestions,
  unknownBlocksOf,
} from "./scripted.ts";

describe("the skill and the scripted answerer", () => {
  const skill = skillText();

  it("knows every block of the skill, and the skill holds every block it knows, each a shell command", () => {
    expect(unknownBlocksOf(skill)).toBeNull();
  });

  it("refuses a skill with a block it does not know, or without one it knows", () => {
    expect(
      unknownBlocksOf(
        `${skill}\n## Something new\n\n\`\`\`sh\ncota memory get /api/traffic\n\`\`\`\n`,
      ),
    ).toBe("the skill has blocks it does not know: Something new #1");
    expect(
      unknownBlocksOf(skill.replace("## Ask in SQL", "## Asking")),
    ).toMatch(
      /^the skill has blocks it does not know: Asking #1; .*, and the skill lacks blocks it knows: Ask in SQL #1; Ask in SQL #2; Ask in SQL #3; Ask in SQL #4$/,
    );
  });

  it("still finds every example value it replaces in its block, and fails a block that no longer holds one", () => {
    for (const name of knownBlocks) {
      const text = blocksOf(skill).find(({ key }) => key === name)?.text ?? "";
      let rest = text;
      for (const example of examples[name]) {
        expect(rest).toContain(example);
        rest = rest.replace(example, "");
      }
      expect(commandOf(skill, name, examples[name])).toBe(text);
    }
    expect(() =>
      commandOf(
        skill.replace("q='login test flaky'", "q='a login test'"),
        "Find a session by what was said #1",
        ["q='webhook retry'"],
      ),
    ).toThrow(
      "Find a session by what was said #1 no longer holds q='login test flaky'",
    );
  });

  it("has a plan for every question of the world", () => {
    expect([...plannedQuestions].sort()).toEqual(
      questions.map(({ id }) => id).sort(),
    );
  });

  it("reads a transcript page as cota memory transcript prints it", () => {
    expect(
      pageOf(
        [
          "session s: segment 1 of 1, read from its tip r (anthropic-messages), 3 entries",
          "segment 1: 2 requests from 2026-10-06T09:12:00.000Z, tip r",
          "#1 system, system message",
          "You are a coding agent.",
          "#2 input, tool result of Bash",
          "line one",
          "#3 is not an entry",
          "… [1200 characters left out]",
          "entries 1 to 2 of 3; the next page: --from 3",
          "",
        ].join("\n"),
      ),
    ).toEqual({
      first:
        "session s: segment 1 of 1, read from its tip r (anthropic-messages), 3 entries",
      entries: [
        {
          number: 1,
          heading: "system, system message",
          text: "You are a coding agent.",
          leftOut: 0,
        },
        {
          number: 2,
          heading: "input, tool result of Bash",
          text: "line one\n#3 is not an entry",
          leftOut: 1200,
        },
      ],
      next: 3,
    });
  });
});
