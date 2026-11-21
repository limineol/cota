import { Api } from "@cota/hub/api";
import { Button } from "@cota/ui/components/button";
import { Confirm } from "@cota/ui/components/confirm";
import { Empty, EmptyDescription, EmptyTitle } from "@cota/ui/components/empty";
import { FieldNote } from "@cota/ui/components/field-note";
import { FieldRule } from "@cota/ui/components/field-rule";
import { Input } from "@cota/ui/components/input";
import { Label } from "@cota/ui/components/label";
import {
  ListPanel,
  ListPanelBody,
  ListPanelHead,
  ListPanelInset,
} from "@cota/ui/components/list-panel";
import { Note } from "@cota/ui/components/note";
import { Subheading } from "@cota/ui/components/page";
import { Skeleton } from "@cota/ui/components/skeleton";
import { Effect } from "effect";
import { HttpApiClient } from "effect/http-api";
import { type FormEvent, type ReactNode, useId, useRef, useState } from "react";
import { type Client, useApiMutation } from "#shared/api.ts";
import { longest, newPasswordOf } from "#shared/domain/new-password.ts";
import { removalsOf } from "#shared/domain/ways-in.ts";
import { passwordRule } from "#shared/password-rule.ts";
import { pausedUntil, untilText } from "#shared/paused.ts";
import { problemOf } from "#shared/problem.tsx";
import { millis, when } from "#shared/words.ts";
import {
  readSignInsAgain,
  readWaysInAgain,
  useKeptPasskeys,
  useOwnerPassword,
} from "./queries.ts";

type Changed =
  | { readonly _tag: "Changed" }
  | { readonly _tag: "WrongPassword" }
  | { readonly _tag: "Paused"; readonly until: number }
  | { readonly _tag: "InConfiguration" };

const decodeChange = HttpApiClient.decodeResponse(Api, {
  group: "sign-in",
  endpoint: "changeOwnerPassword",
});

const change =
  ({
    current,
    password,
  }: {
    readonly current: string | null;
    readonly password: string;
  }) =>
  (client: Client): Effect.Effect<Changed, unknown> =>
    Effect.gen(function* () {
      const response = yield* client["sign-in"].changeOwnerPassword({
        payload: current === null ? { password } : { current, password },
        responseMode: "response-only",
      });
      return yield* decodeChange(response).pipe(
        Effect.as<Changed>({ _tag: "Changed" }),
        Effect.catchTag("WrongPassword", () =>
          Effect.succeed<Changed>({ _tag: "WrongPassword" }),
        ),
        Effect.catchTag("PasswordInConfiguration", () =>
          Effect.succeed<Changed>({ _tag: "InConfiguration" }),
        ),
        Effect.catchTag("TooManyAttempts", () =>
          Effect.map(
            pausedUntil(response),
            (until): Changed => ({ _tag: "Paused", until }),
          ),
        ),
      );
    });

type Forgotten =
  | { readonly _tag: "Forgotten" }
  | { readonly _tag: "LastWayIn" };

const forget = (_: undefined) => (client: Client) =>
  client["sign-in"].forgetOwnerPassword().pipe(
    Effect.as<Forgotten>({ _tag: "Forgotten" }),
    Effect.catchTag("LastWayIn", () =>
      Effect.succeed<Forgotten>({ _tag: "LastWayIn" }),
    ),
  );

type Done = "changed" | "set" | "turned-off" | null;

/** Where the owner password is kept, and changing, setting or turning it off in place. */
export function OwnerPassword({ owner }: { readonly owner: boolean }) {
  const title = useId();
  const kept = useOwnerPassword(owner);
  const passkeys = useKeptPasskeys(owner);
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState<Done>(null);
  const turnOff = useApiMutation(forget, async (outcome, queries) => {
    await readWaysInAgain(queries);
    if (outcome._tag === "Forgotten") setDone("turned-off");
  });

  const head = (children: ReactNode) => (
    <ListPanel aria-labelledby={title}>
      <ListPanelHead alone className="min-h-13 items-center">
        {children}
      </ListPanelHead>
    </ListPanel>
  );

  const heading = (
    <Subheading level={2} id={title}>
      Owner password
    </Subheading>
  );

  if (!owner) {
    return (
      <ListPanel aria-labelledby={title}>
        <ListPanelHead>{heading}</ListPanelHead>
        <ListPanelBody>
          <Empty>
            <EmptyTitle>A reader key cannot see the owner password.</EmptyTitle>
            <EmptyDescription>
              The ways in are the owner's alone: sign in as the owner to change
              the password, turn it off or add a passkey.
            </EmptyDescription>
          </Empty>
        </ListPanelBody>
      </ListPanel>
    );
  }

  if (kept.isError || passkeys.isError) {
    const failed = kept.isError ? kept : passkeys;
    return head(
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {heading}
        <FieldNote tone="danger" className="mt-0">
          The hub could not say where the password is kept:{" "}
          {problemOf(failed.error)}
        </FieldNote>
        <Button
          variant="outline"
          size="sm"
          className="mt-2 self-start"
          onClick={() => failed.refetch()}
        >
          Try again
        </Button>
      </div>,
    );
  }

  if (kept.data === undefined || passkeys.data === undefined) {
    return head(
      <div className="flex min-w-0 flex-1 flex-col gap-1.5" aria-busy="true">
        {heading}
        <Skeleton className="w-64" />
      </div>,
    );
  }

  const { source, setAt } = kept.data;
  const removals = removalsOf(source, passkeys.data.passkeys.length);

  const where = () => {
    switch (source) {
      case "configuration":
        return "Kept in the hub's configuration. It is changed in the configuration file, and it wins over one set here.";
      case "hub-store":
        return setAt === null
          ? "Kept in this hub."
          : `Kept in this hub, set ${when(millis(setAt), Date.now())}.`;
      case "none":
        return "Off: the hub is signed in to with a passkey only.";
    }
  };

  const doneWords = () => {
    switch (done) {
      case "changed":
        return "Changed. Every other sign-in was ended.";
      case "set":
        return "Set. Every other sign-in was ended.";
      case "turned-off":
        return "Turned off.";
      case null:
        return null;
    }
  };

  const open = (what: "edit" | "ask") => {
    setDone(null);
    turnOff.reset();
    setEditing(what === "edit");
    setAsking(what === "ask");
  };

  const actions = () => {
    if (editing || asking) return null;
    if (source === "none") {
      return (
        <Button variant="outline" size="sm" onClick={() => open("edit")}>
          Set a password
        </Button>
      );
    }
    if (source === "configuration") return null;
    return (
      <span className="flex shrink-0 items-center gap-1.5">
        <Button variant="outline" size="sm" onClick={() => open("edit")}>
          Change
        </Button>
        {removals.turnOff === "offered" ? (
          <Button variant="outline" size="sm" onClick={() => open("ask")}>
            Turn off
          </Button>
        ) : null}
      </span>
    );
  };

  const finished = doneWords();

  return (
    <ListPanel aria-labelledby={title}>
      <ListPanelHead alone={!editing} className="min-h-13 items-center">
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
          {heading}
          <Note>{where()}</Note>
          {removals.turnOff === "wants-a-passkey" && !editing ? (
            <Note>
              It can be turned off once a passkey is added: until then it is the
              only way in.
            </Note>
          ) : null}
        </div>
        {actions()}
        {asking ? (
          <Confirm
            className="basis-full"
            question="Turn the owner password off? The hub forgets it and is signed in to with a passkey only, on every browser. A password can be set here again."
            confirm="Turn it off"
            cancel="Keep it"
            pending={turnOff.isPending}
            onCancel={() => setAsking(false)}
            onConfirm={() =>
              turnOff.mutate(undefined, { onSettled: () => setAsking(false) })
            }
          />
        ) : null}
        {turnOff.data?._tag === "LastWayIn" ? (
          <FieldNote tone="danger" className="basis-full">
            Not turned off: the password is the last way in now, as a passkey
            was removed from another browser. The ways in are read again.
          </FieldNote>
        ) : null}
        {turnOff.isError ? (
          <FieldNote tone="danger" className="basis-full">
            Not turned off: {problemOf(turnOff.error)}
          </FieldNote>
        ) : null}
        {finished === null ? null : (
          <FieldNote className="basis-full">{finished}</FieldNote>
        )}
      </ListPanelHead>
      {editing ? (
        <ListPanelInset>
          <PasswordForm
            asksCurrent={source === "hub-store"}
            onCancel={() => setEditing(false)}
            onDone={() => {
              setEditing(false);
              setDone(source === "hub-store" ? "changed" : "set");
            }}
          />
        </ListPanelInset>
      ) : null}
    </ListPanel>
  );
}

function PasswordForm({
  asksCurrent,
  onCancel,
  onDone,
}: {
  readonly asksCurrent: boolean;
  readonly onCancel: () => void;
  readonly onDone: () => void;
}) {
  const ids = useId();
  const firstField = useRef<HTMLInputElement>(null);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [tried, setTried] = useState(false);
  const chosen = newPasswordOf(password);
  const send = useApiMutation(change, async (outcome, queries) => {
    if (outcome._tag === "Changed") {
      await Promise.all([readWaysInAgain(queries), readSignInsAgain(queries)]);
      onDone();
    }
    if (outcome._tag === "InConfiguration") await readWaysInAgain(queries);
  });
  const outcome = send.data;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTried(true);
    if (!chosen.fits || send.isPending) return;
    send.mutate(
      { current: asksCurrent ? current : null, password },
      {
        onSettled: (settled) => {
          if (settled?._tag === "WrongPassword") {
            firstField.current?.focus();
            firstField.current?.select();
          }
        },
      },
    );
  };

  const currentProblem =
    outcome?._tag === "WrongPassword"
      ? asksCurrent
        ? "That is not the current password."
        : "A password was set meanwhile, from another browser: it is changed with the current one."
      : null;

  const problem = () => {
    if (send.isError) {
      return `Not saved: ${problemOf(send.error)}`;
    }
    switch (outcome?._tag) {
      case "Paused":
        return `Changing the password is paused until ${untilText(outcome.until)}: too many wrong passwords were given in the last 10 minutes.`;
      case "InConfiguration":
        return "Not saved: the hub's configuration holds the owner password now, and it is changed there.";
      default:
        return null;
    }
  };

  const general = problem();

  return (
    <form
      className="flex max-w-md flex-col gap-4"
      aria-label={
        asksCurrent ? "Change the owner password" : "Set the owner password"
      }
      onSubmit={submit}
    >
      {asksCurrent ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`${ids}-current`}>Current password</Label>
          <Input
            ref={firstField}
            id={`${ids}-current`}
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            aria-invalid={currentProblem !== null}
            {...(currentProblem === null
              ? {}
              : { "aria-describedby": `${ids}-current-problem` })}
          />
          {currentProblem === null ? null : (
            <FieldNote id={`${ids}-current-problem`} tone="danger">
              {currentProblem}
            </FieldNote>
          )}
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${ids}-new`}>
          {asksCurrent ? "New password" : "Owner password"}
        </Label>
        <Input
          {...(asksCurrent ? {} : { ref: firstField })}
          id={`${ids}-new`}
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={tried && !chosen.fits}
          aria-describedby={`${ids}-rule`}
        />
        <FieldRule
          id={`${ids}-rule`}
          met={chosen.fits}
          refused={tried || chosen.length > longest}
        >
          {passwordRule(chosen, tried)}
        </FieldRule>
        {!asksCurrent && currentProblem !== null ? (
          <FieldNote tone="danger">{currentProblem}</FieldNote>
        ) : null}
      </div>
      {general === null ? null : <FieldNote tone="danger">{general}</FieldNote>}
      <span className="flex items-center gap-1.5">
        <Button type="submit" size="sm" disabled={send.isPending}>
          {send.isPending
            ? "Saving…"
            : asksCurrent
              ? "Change the password"
              : "Set the password"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </span>
      <Note>
        {asksCurrent
          ? "Every other browser signed in is signed out once it is changed."
          : "Every other browser signed in is signed out once it is set."}
      </Note>
    </form>
  );
}
