const lineBreak = /\r\n|[\n\r\u2028\u2029]/;

const messageField = /"message"\s*:\s*"((?:[^"\\]|\\.)*)(?:"|\\?$)/;

const firstLineOf = (text: string) =>
  text
    .split(lineBreak)
    .map((line) => line.trim())
    .find((line) => line !== "") ?? "";

const unescaped = (body: string) => {
  try {
    const value: unknown = JSON.parse(`"${body}"`);
    return typeof value === "string" ? value : body;
  } catch {
    return body;
  }
};

/**
 * An error message's headline, one line: when the message begins as a JSON
 * object, the first line of its first `"message"` field that is not blank,
 * read even when the hub's cut left the field or the object unclosed;
 * otherwise the message's own first line that is not blank. Both are trimmed.
 */
export const headlineOf = (message: string): string => {
  if (message.trimStart().startsWith("{")) {
    const field = messageField.exec(message)?.[1];
    const line = field === undefined ? "" : firstLineOf(unescaped(field));
    if (line !== "") return line;
  }
  return firstLineOf(message);
};
