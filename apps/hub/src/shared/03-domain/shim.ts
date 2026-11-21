/** The words that mark a file as one of `cota`'s shims, in its second line (`docs/specs/cli/spec.md`, Shims). */
export const shimMarker = "cota: this shim launches its client through cota";

/** How much of the start of a file is read to tell one of `cota`'s shims. */
export const shimHeadBytes = 512;

/** Whether the start of a file says it is one of `cota`'s shims, which a client's real command never is. */
export const isShim = (head: string): boolean => head.includes(shimMarker);
