import { Button } from "@cota/ui/components/button";
import {
  CodeEditor,
  CodeEditorBar,
  CodeEditorPanel,
  CodeEditorStatus,
  Kbd,
} from "@cota/ui/components/code-editor";
import { DataGridMessage, DataGridPanel } from "@cota/ui/components/data-grid";
import { Menu, MenuGroup, MenuItem, MenuNote } from "@cota/ui/components/menu";
import {
  Page,
  PageDescription,
  PageHeader,
  PageTitle,
} from "@cota/ui/components/page";
import { SchemaLayout, SchemaToggle } from "@cota/ui/components/schema-tree";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { BookOpen, History, LoaderCircle, Play, Table2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { statementOf, tokensOf } from "#shared/domain/sql.ts";
import { NowProvider, useNow } from "#shared/now.tsx";
import { plural, when } from "#shared/words.ts";
import { Answer, elapsedOf } from "./answer.tsx";
import { examples } from "./examples.ts";
import { RunFailure } from "./failure.tsx";
import {
  keepDraft,
  keepRuns,
  type Run,
  readDraft,
  readRuns,
  withRun,
} from "./kept.ts";
import { type RunAnswer, useRun } from "./queries.ts";
import { Schema } from "./schema.tsx";

/** What the last run came to: its answer, its failure, or that it was cancelled. */
type Outcome =
  | {
      readonly kind: "answered";
      readonly sql: string;
      readonly answer: RunAnswer;
    }
  | {
      readonly kind: "failed";
      readonly sql: string;
      /** Where the statement begins in the editor's text, for a position ClickHouse gives. */
      readonly offset: number;
      readonly error: unknown;
    }
  | {
      readonly kind: "cancelled";
      readonly sql: string;
      readonly after: number;
    };

const firstExample = examples[0]?.sql ?? "SELECT 1";

const onMac = () =>
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.userAgent);

/** A name as SQL takes it: as it is when it is a plain identifier, else in backticks. */
const nameInSql = (name: string) =>
  /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
    ? name
    : `\`${name.replaceAll("\\", "\\\\").replaceAll("`", "\\`")}\``;

export function Sql() {
  return (
    <NowProvider>
      <SqlPage />
    </NowProvider>
  );
}

function RunDetail({ run, now }: { readonly run: Run; readonly now: number }) {
  const at = when(run.at, now);
  if (run.answered === null) return `${at} · failed`;
  return `${at} · ${plural(run.answered.rows, "row")}${run.answered.truncated ? ", cut" : ""} · ${elapsedOf(run.answered.elapsedMs)}`;
}

function SqlPage() {
  const search = useSearch({ from: "/sql" });
  const navigate = useNavigate({ from: "/sql" });
  const now = useNow();
  const editor = useRef<HTMLTextAreaElement>(null);
  const [sql, setSql] = useState(() => search.q ?? readDraft() ?? firstExample);
  const [selecting, setSelecting] = useState(false);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [runs, setRuns] = useState(readRuns);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const run = useRun();
  const abandon = useRef<AbortController | null>(null);
  const pieces = useMemo(() => tokensOf(sql), [sql]);
  const shortcut = useMemo(() => (onMac() ? "⌘↵" : "Ctrl ↵"), []);

  const edit = (text: string) => {
    setSql(text);
    keepDraft(text);
  };

  const remember = (entry: Run) =>
    setRuns((current) => {
      const next = withRun(current, entry);
      keepRuns(next);
      return next;
    });

  const start = (statement: string, offset: number) => {
    if (statement === "") return;
    abandon.current?.abort();
    const controller = new AbortController();
    abandon.current = controller;
    void navigate({ search: { q: statement }, replace: true });
    const at = Date.now();
    run.mutate(
      { sql: statement, signal: controller.signal },
      {
        onSuccess: (answer) => {
          setOutcome({ kind: "answered", sql: statement, answer });
          remember({
            sql: statement,
            at,
            answered: {
              rows: answer.rows.length,
              elapsedMs: answer.elapsedMs,
              truncated: answer.truncated,
            },
          });
        },
        onError: (error) => {
          if (controller.signal.aborted) return;
          setOutcome({ kind: "failed", sql: statement, offset, error });
          remember({ sql: statement, at, answered: null });
        },
      },
    );
  };

  const runEditor = () => {
    const field = editor.current;
    const from = field?.selectionStart ?? 0;
    const to = field?.selectionEnd ?? 0;
    const statement = statementOf(sql, from, to);
    const selected = sql.slice(Math.min(from, to), Math.max(from, to));
    const offset = sql.indexOf(
      statement,
      selected.trim() === "" ? 0 : Math.min(from, to),
    );
    start(statement, offset);
  };

  const cancel = () => {
    abandon.current?.abort();
    abandon.current = null;
    const statement = run.variables?.sql ?? "";
    const after = Math.max(0, Date.now() - run.submittedAt);
    run.reset();
    setOutcome({ kind: "cancelled", sql: statement, after });
  };

  const linked = useRef(false);
  useEffect(() => {
    if (linked.current) return;
    linked.current = true;
    if (search.q !== undefined) start(search.q, sql.indexOf(search.q));
  });

  useEffect(() => () => abandon.current?.abort(), []);

  const insert = (name: string) => {
    const field = editor.current;
    if (field === null) return;
    field.setRangeText(
      nameInSql(name),
      field.selectionStart,
      field.selectionEnd,
      "end",
    );
    edit(field.value);
    field.focus();
  };

  const showAt = (failed: Extract<Outcome, { kind: "failed" }>) => {
    const { offset } = failed;
    if (
      offset < 0 ||
      sql.slice(offset, offset + failed.sql.length) !== failed.sql
    ) {
      return null;
    }
    return (position: number) => {
      const field = editor.current;
      if (field === null) return;
      const at = offset + Math.min(position - 1, failed.sql.length);
      field.focus();
      field.setSelectionRange(at, at);
    };
  };

  const choose = (text: string) => {
    edit(text);
    editor.current?.focus();
  };

  const seconds = run.isPending
    ? Math.max(0, Math.floor((now - run.submittedAt) / 1000))
    : 0;
  const lines = sql.split("\n").length;

  const results = () => {
    if (outcome === null) {
      return run.isPending ? null : (
        <DataGridPanel>
          <DataGridMessage>
            <p>Run the query to see its rows here.</p>
          </DataGridMessage>
        </DataGridPanel>
      );
    }
    switch (outcome.kind) {
      case "answered":
        return (
          <Answer
            key={outcome.sql}
            answer={outcome.answer}
            stale={run.isPending}
          />
        );
      case "failed":
        return (
          <RunFailure
            error={outcome.error}
            sql={outcome.sql}
            onShow={showAt(outcome)}
            onRetry={() => start(outcome.sql, outcome.offset)}
          />
        );
      case "cancelled":
        return (
          <DataGridPanel>
            <DataGridMessage>
              <p>
                The run was cancelled after {elapsedOf(outcome.after)}. Its
                answer, should the hub send one, is not shown.
              </p>
            </DataGridMessage>
          </DataGridPanel>
        );
    }
  };

  return (
    <Page className="@container">
      <PageHeader>
        <div>
          <PageTitle>SQL</PageTitle>
          <PageDescription>
            Read-only ClickHouse SQL over the request log.
          </PageDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SchemaToggle>
            <Button
              variant="outline"
              size="sm"
              aria-expanded={schemaOpen}
              aria-controls="sql-schema"
              onClick={() => setSchemaOpen(!schemaOpen)}
            >
              <Table2 aria-hidden="true" />
              Schema
            </Button>
          </SchemaToggle>
          <Menu label="Examples" icon={<BookOpen aria-hidden="true" />}>
            {examples.map((example) => (
              <MenuItem
                key={example.title}
                title={example.title}
                detail={example.detail}
                onClick={() => choose(example.sql)}
              />
            ))}
          </Menu>
          <Menu label="History" icon={<History aria-hidden="true" />}>
            <MenuGroup label="This browser's last runs, kept here only">
              {runs.length === 0 ? (
                <MenuNote>Nothing has been run in this browser yet</MenuNote>
              ) : (
                runs.map((each) => (
                  <MenuItem
                    key={each.sql}
                    code
                    title={each.sql.replaceAll(/\s+/g, " ")}
                    detail={<RunDetail run={each} now={now} />}
                    onClick={() => choose(each.sql)}
                  />
                ))
              )}
            </MenuGroup>
          </Menu>
        </div>
      </PageHeader>

      <SchemaLayout>
        <Schema open={schemaOpen} onInsert={insert} />
        <div className="flex min-w-0 flex-col gap-4">
          <CodeEditorPanel>
            <CodeEditor
              ref={editor}
              aria-label="SQL"
              value={sql}
              pieces={pieces}
              onValueChange={edit}
              onRun={runEditor}
              onSelect={(event) =>
                setSelecting(
                  event.currentTarget.selectionStart !==
                    event.currentTarget.selectionEnd,
                )
              }
            />
            <CodeEditorBar>
              {run.isPending ? (
                <>
                  <Button size="sm" disabled>
                    <LoaderCircle
                      aria-hidden="true"
                      className="motion-safe:animate-spin"
                    />
                    Running… {seconds}s
                  </Button>
                  <Button variant="outline" size="sm" onClick={cancel}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={runEditor}>
                  <Play aria-hidden="true" />
                  {selecting ? "Run selection" : "Run"} <Kbd>{shortcut}</Kbd>
                </Button>
              )}
              <CodeEditorStatus>{plural(lines, "line")}</CodeEditorStatus>
            </CodeEditorBar>
          </CodeEditorPanel>
          <div aria-live="polite" className="sr-only">
            {run.isPending ? "Running the query" : ""}
          </div>
          {results()}
        </div>
      </SchemaLayout>
    </Page>
  );
}
