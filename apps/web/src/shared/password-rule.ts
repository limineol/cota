import { longest, type newPasswordOf } from "./domain/new-password.ts";
import { counted } from "./words.ts";

/** The rule under a new owner password's field, in words: once the form was sent, why the password was not. */
export const passwordRule = (
  chosen: ReturnType<typeof newPasswordOf>,
  tried: boolean,
) => {
  if (chosen.length > longest) {
    return `${counted(longest)} characters at most; this one is ${counted(chosen.length)}.`;
  }
  if (tried && !chosen.fits) {
    return `12 characters or more; this one is ${counted(chosen.length)}, so it was not sent.`;
  }
  return "12 characters or more";
};
