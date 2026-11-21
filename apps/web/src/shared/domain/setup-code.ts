/** How many characters a setup code has. */
export const codeLength = 12;

/**
 * A setup code as the owner typed it, read as the hub reads one: spaces and
 * hyphens out, the rest upper-cased, `O` as `0` and `I` and `L` as `1`
 * (`docs/specs/sign-in/spec.md`, Setup code), and no more than its twelve.
 * `written` is what the field shows, in groups of four joined by hyphens;
 * `code` is what is sent; `complete` whether it has all twelve (V41).
 */
export const setupCodeOf = (typed: string) => {
  const code = [
    ...typed
      .replaceAll(/[-\s]/g, "")
      .toUpperCase()
      .replaceAll("O", "0")
      .replaceAll(/[IL]/g, "1"),
  ]
    .slice(0, codeLength)
    .join("");
  const written = (code.match(/.{1,4}/gu) ?? []).join("-");
  return { written, code, complete: [...code].length === codeLength };
};
