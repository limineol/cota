/** The fewest characters the hub takes in a new owner password (ADR-0021). */
export const shortest = 12;

/** The most characters the hub takes in any owner password. */
export const longest = 1024;

/** A new owner password as the hub would count it: its characters, as code points, and whether it holds 12 to 1,024 of them (V42). */
export const newPasswordOf = (text: string) => {
  const length = [...text].length;
  return { length, fits: length >= shortest && length <= longest };
};
