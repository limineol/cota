import { describe, expect, it } from "@effect/vitest";
import * as ClientFiles from "./client-files.ts";

const dollars = (amount: number) => BigInt(Math.round(amount * 1e12));

describe("a model as written into OpenCode's and Pi's files", () => {
  it("costs its base rates in dollars per million tokens, its cache write the short one, whatever its tiers", () => {
    expect(
      ClientFiles.writtenModelOf({
        id: "coder-large",
        name: "Coder Large",
        contextTokens: 400000,
        outputTokens: null,
        imageInput: true,
        price: {
          base: {
            input: dollars(1.25),
            cacheRead: dollars(0.125),
            cacheWriteShort: dollars(1.5625),
            cacheWriteLong: dollars(2.5),
            output: dollars(10),
          },
          tiers: [
            {
              threshold: 200000,
              rates: {
                input: dollars(2.5),
                cacheRead: dollars(0.25),
                cacheWriteShort: dollars(3.125),
                cacheWriteLong: dollars(5),
                output: dollars(15),
              },
            },
          ],
        },
      }),
    ).toEqual({
      id: "coder-large",
      name: "Coder Large",
      context: 400000,
      output: null,
      images: true,
      cost: { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite: 1.5625 },
    });
  });

  it("is its id alone when the hub has no facts for it", () => {
    expect(ClientFiles.listedModels(["made-up"], [])).toEqual([
      {
        id: "made-up",
        name: "made-up",
        context: null,
        output: null,
        images: null,
        cost: null,
      },
    ]);
  });
});
