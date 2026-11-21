/** What pairing reads of a transcript's entry: its kind, and the call id of a tool call or a tool result. */
export interface Pairable {
  readonly kind: string;
  readonly callId?: string | null;
}

/** One row of a transcript: an entry by its index, and for a tool call the index of the result paired with it. */
export interface Row {
  readonly at: number;
  readonly result: number | null;
}

/**
 * The entries as rows, in order: each tool result that follows an unpaired
 * call of its call id goes inside the nearest such call's row, and every
 * other entry is a row of its own.
 */
export const pairCalls = (
  entries: ReadonlyArray<Pairable>,
): ReadonlyArray<Row> => {
  const rows: Array<{ at: number; result: number | null }> = [];
  const waiting = new Map<string, Array<number>>();
  entries.forEach((entry, at) => {
    const callId = entry.callId ?? null;
    if (entry.kind === "tool-result" && callId !== null) {
      const row = waiting.get(callId)?.pop();
      const call = row === undefined ? undefined : rows[row];
      if (call !== undefined) {
        call.result = at;
        return;
      }
    }
    if (entry.kind === "tool-call" && callId !== null) {
      const calls = waiting.get(callId) ?? [];
      calls.push(rows.length);
      waiting.set(callId, calls);
    }
    rows.push({ at, result: null });
  });
  return rows;
};
