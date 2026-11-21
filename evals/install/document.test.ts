import { readFileSync } from "node:fs";
import { describe, expect, it } from "@effect/vitest";
import { blocksOf, changed, sectionOf, unmatchedOf } from "./document.ts";
import { root } from "./evaluation.ts";
import { known, secretFilesOf, tableOf } from "./rehearsal.ts";
import { tasks } from "./tasks.ts";

const prompt = readFileSync(`${root}/docs/install.md`, "utf8");

const markdown = [
  "# Title",
  "## One",
  "```sh",
  "first",
  "```",
  "> Tell the owner",
  "> this.",
  "### Two",
  "```text",
  "out",
  "```",
  "```sh",
  "second",
  "```",
  "## Three",
  "Prose.",
].join("\n");

describe("the install prompt, as the rehearsal reads it", () => {
  it("knows every block of the prompt, and the prompt has every block it knows", () => {
    expect(unmatchedOf(blocksOf(prompt), Object.values(known))).toEqual({
      unknown: [],
      missing: [],
    });
  });

  it("names each block by its section and its place there, quotes included", () => {
    expect(
      blocksOf(markdown).map(({ key, kind, text }) => [key, kind, text]),
    ).toEqual([
      ["One #1", "sh", "first"],
      ["One #2", "quote", "Tell the owner\nthis."],
      ["One › Two #1", "text", "out"],
      ["One › Two #2", "sh", "second"],
    ]);
  });

  it("says which block it does not know and which it knows that is gone", () => {
    const { unknown, missing } = unmatchedOf(blocksOf(markdown), [
      "One #1",
      "One #2",
      "One › Two #1",
      "Three #1",
    ]);
    expect(unknown.map(({ key }) => key)).toEqual(["One › Two #2"]);
    expect(missing).toEqual(["Three #1"]);
  });

  it("refuses a fenced block of a kind it does not read", () => {
    expect(() => blocksOf("## A\n```bash\nls\n```\n")).toThrow(
      'fenced block of "bash"',
    );
  });

  it("reads a section up to the next heading of its level", () => {
    expect(sectionOf(markdown, "One › Two")).toBe(
      "```text\nout\n```\n```sh\nsecond\n```",
    );
    expect(sectionOf(markdown, "Three")).toBe("Prose.");
  });

  it("fails a change that no longer applies, naming the block", () => {
    const [block] = blocksOf(markdown);
    if (block === undefined) throw new Error("no block");
    expect(changed(block, [{ from: "first", to: "1st" }])).toBe("1st");
    expect(() => changed(block, [{ from: "second", to: "2nd" }])).toThrow(
      'The rehearsal\'s change of "second" no longer applies to One #1',
    );
  });

  it("writes each pool's table from the prompt's example of its kind, with the owner's name and files", () => {
    const [task] = tasks;
    const pools = blocksOf(prompt).find(({ key }) => key === known.pools);
    if (task === undefined || pools === undefined)
      throw new Error("no task or block");
    expect(task.pools.map((pool) => tableOf(pools, pool))).toEqual([
      '[pools.work]\nprotocol = "anthropic-messages"\nprices = "anthropic"\nfallback = "personal"',
      '[pools.personal]\nprotocol = "anthropic-messages"\nprices = "anthropic"\nkept_login = { file = "/etc/cota/secrets/personal-login" }',
      '[pools.chatgpt]\nprotocol = "chatgpt-codex"\nprices = "openai"',
      '[pools.zai]\nprotocol = "openai-chat"\nprovider = "zai"\nbase_url = "https://api.z.ai/api/coding/paas/v4"\nkey = { file = "/etc/cota/secrets/zai" }\nprices = "zai"',
    ]);
    expect(secretFilesOf(task).map(({ name }) => name)).toEqual([
      "personal-login",
      "zai",
    ]);
  });
});
