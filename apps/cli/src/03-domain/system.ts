import { Schema } from "effect";

/** The systems `cota` runs on, by the names Node and Bun give them. */
export const System = Schema.Literals(["darwin", "linux", "win32"]);
export type System = typeof System.Type;

/** The environment's variables, as a process was given them. */
export type Variables = Readonly<Record<string, string | undefined>>;
