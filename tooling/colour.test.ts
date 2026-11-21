import { describe, expect, it } from "vitest";
import { apart, contrast, difference } from "./colour.ts";

describe("colour", () => {
  it("gives WCAG's contrast ratios: 21 for black on white, 1 for a colour on itself", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 9);
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 9);
    expect(contrast("#777777", "#777777")).toBe(1);
    expect(contrast("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  it("gives the CIEDE2000 differences of Sharma, Wu and Dalal's test pairs", () => {
    expect(difference([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(
      2.0425,
      4,
    );
    expect(difference([50, 0, 0], [50, -1, 2])).toBeCloseTo(2.3669, 4);
    expect(difference([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 4);
    expect(
      difference([60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387]),
    ).toBeCloseTo(1.2644, 4);
    expect(
      difference([22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619]),
    ).toBeCloseTo(2.0373, 4);
  });

  it("sees red and green apart in normal vision and close together without red cones", () => {
    expect(apart("normal", "#d03030", "#30a030")).toBeGreaterThan(40);
    expect(apart("protanopia", "#d03030", "#30a030")).toBeLessThan(
      apart("normal", "#d03030", "#30a030") / 2,
    );
  });
});
