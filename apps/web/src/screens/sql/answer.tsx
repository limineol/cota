import { CopyButton } from "@cota/ui/components/copy-button";
import {
  DataGrid,
  DataGridActions,
  type DataGridCell,
  DataGridFoot,
  DataGridInspector,
  DataGridMessage,
  DataGridPanel,
  DataGridText,
  dataGridOverscan,
  dataGridRowHeight,
} from "@cota/ui/components/data-grid";
import { JsonView } from "@cota/ui/components/json-view";
import { Note } from "@cota/ui/components/note";
import { useMemo, useState } from "react";
import { drawnRows } from "#shared/domain/grid.ts";
import { textOf, tsvOf } from "#shared/domain/tsv.ts";
import { counted, plural } from "#shared/words.ts";
import { cellOf, columnsOf, jsonIn } from "./cells.ts";
import type { RunAnswer } from "./queries.ts";

/** How long ClickHouse took: milliseconds under a second, then seconds to two places. */
export const elapsedOf = (milliseconds: number) =>
  milliseconds < 1000
    ? `${counted(milliseconds)} ms`
    : `${(milliseconds / 1000).toFixed(2)} s`;

function Inspected({
  answer,
  cell,
  onClose,
}: {
  readonly answer: RunAnswer;
  readonly cell: DataGridCell;
  readonly onClose: () => void;
}) {
  const column = answer.columns[cell.column];
  const value = answer.rows[cell.row]?.[cell.column] ?? null;
  const json = value === null ? undefined : jsonIn(value);
  const whole = () => (value === null ? "" : textOf(value));
  return (
    <DataGridInspector
      title={
        <>
          Row {counted(cell.row + 1)} · <strong>{column?.name}</strong>{" "}
          <code>{column?.type}</code>
        </>
      }
      actions={
        value === null ? null : (
          <CopyButton
            label="Copy the value"
            copied="The value is copied."
            value={whole}
          />
        )
      }
      onClose={onClose}
    >
      {value === null ? (
        <DataGridText>NULL, no value</DataGridText>
      ) : json === undefined ? (
        <DataGridText>
          {whole() === "" ? "An empty string" : whole()}
        </DataGridText>
      ) : (
        <JsonView value={json} className="max-h-80 overflow-auto" />
      )}
    </DataGridInspector>
  );
}

/**
 * An answer: its rows in a grid drawn where they are seen, a line of its
 * rows and time with a copy as TSV, what to do when the hub cut it, and the
 * cell inspected. While `stale`, a newer run is on its way.
 */
export function Answer({
  answer,
  stale,
}: {
  readonly answer: RunAnswer;
  readonly stale: boolean;
}) {
  const [inspected, setInspected] = useState<DataGridCell | null>(null);
  const columns = useMemo(() => columnsOf(answer), [answer]);
  const rows = answer.rows.length;
  return (
    <DataGridPanel stale={stale}>
      {answer.columns.length === 0 ? null : (
        <DataGrid
          label="The answer"
          columns={columns}
          rows={rows}
          drawn={({ top, height }) =>
            drawnRows({
              top,
              height,
              rowHeight: dataGridRowHeight,
              rows,
              overscan: dataGridOverscan,
            })
          }
          cell={(row, column) => cellOf(answer.rows[row]?.[column])}
          inspected={inspected}
          onInspect={setInspected}
        />
      )}
      {rows === 0 ? (
        <DataGridMessage>
          <p>The query answered no rows.</p>
        </DataGridMessage>
      ) : null}
      <DataGridFoot>
        <span>
          <strong>{counted(rows)}</strong> {rows === 1 ? "row" : "rows"}
          {answer.truncated ? ", and more the hub did not send" : ""}
        </span>
        <span>{elapsedOf(answer.elapsedMs)}</span>
        {rows === 0 ? null : (
          <DataGridActions>
            <CopyButton
              label="Copy the answer as TSV"
              copied={`${plural(rows, "row")} copied as TSV.`}
              value={() =>
                tsvOf(
                  answer.columns.map((column) => column.name),
                  answer.rows,
                )
              }
            >
              Copy as TSV
            </CopyButton>
          </DataGridActions>
        )}
        {answer.truncated ? (
          <Note className="basis-full">
            The hub cut the answer at its limit, by default 5,000 rows or 16 MiB
            of them, set in its configuration's <code>[sql]</code>. Add a{" "}
            <code>LIMIT</code> or an aggregate, or select fewer columns, to see
            what you need within it.
          </Note>
        ) : null}
      </DataGridFoot>
      {inspected === null ? null : (
        <Inspected
          answer={answer}
          cell={inspected}
          onClose={() => setInspected(null)}
        />
      )}
    </DataGridPanel>
  );
}
