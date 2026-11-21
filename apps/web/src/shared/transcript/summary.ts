/** The fields a call's input is best summed up by, in the order they are looked for. */
const telling = [
  "command",
  "cmd",
  "pattern",
  "file_path",
  "path",
  "url",
  "query",
  "description",
  "prompt",
  "name",
];

const parsed = (json: string): unknown => {
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** A call's input in one line: its most telling string field, else its first, else the input as it came. */
export const inputSummary = (input: string): string => {
  const value = parsed(input);
  if (typeof value === "string") return oneLine(value);
  if (!isRecord(value)) return oneLine(input);
  const field =
    telling.find((key) => typeof value[key] === "string") ??
    Object.keys(value).find((key) => typeof value[key] === "string");
  const text = field === undefined ? undefined : value[field];
  return typeof text === "string" ? oneLine(text) : oneLine(input);
};

/** JSON set out to be read, two spaces a level, or the text as it came when it is not JSON. */
export const setOut = (json: string): string => {
  const value = parsed(json);
  return value === undefined ? json : JSON.stringify(value, null, 2);
};

/** How many lines a text has; an empty one has none. */
export const linesOf = (text: string): number =>
  text === "" ? 0 : text.split("\n").length;

/** A text's first line that holds anything, in one line. */
export const firstLine = (text: string): string =>
  oneLine(text.split("\n").find((line) => line.trim() !== "") ?? "");
