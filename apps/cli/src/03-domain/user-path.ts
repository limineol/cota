const sameDirectory = (entry: string, directory: string) => {
  const normal = (each: string) => each.replace(/[\\/]+$/, "").toLowerCase();
  return normal(entry) === normal(directory);
};

const entriesOf = (path: string): ReadonlyArray<string> =>
  path === "" ? [] : path.split(";");

/** The user's `Path` with the shims' directory once, as its first entry, and every other entry as it was, in order. */
export const withShimsFirst = (path: string, shims: string): string =>
  [
    shims,
    ...entriesOf(path).filter((entry) => !sameDirectory(entry, shims)),
  ].join(";");

/** The user's `Path` without the shims' directory, and every other entry as it was, in order. */
export const withoutShims = (path: string, shims: string): string =>
  entriesOf(path)
    .filter((entry) => !sameDirectory(entry, shims))
    .join(";");

/** Whether the user's `Path` starts with the shims' directory. */
export const startsWithShims = (path: string, shims: string): boolean =>
  sameDirectory(entriesOf(path)[0] ?? "", shims);
