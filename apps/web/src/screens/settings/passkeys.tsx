import { Button } from "@cota/ui/components/button";
import { Confirm } from "@cota/ui/components/confirm";
import { Empty, EmptyDescription, EmptyTitle } from "@cota/ui/components/empty";
import { FieldNote } from "@cota/ui/components/field-note";
import {
  ListPanel,
  ListPanelBody,
  ListPanelFoot,
  ListPanelHead,
} from "@cota/ui/components/list-panel";
import { Note } from "@cota/ui/components/note";
import { Subheading } from "@cota/ui/components/page";
import { Skeleton } from "@cota/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableLabel,
  TableRow,
  TableSecondary,
} from "@cota/ui/components/table";
import { TableItem, TableMore } from "@cota/ui/components/table-more";
import { Effect } from "effect";
import { KeyRound } from "lucide-react";
import { useId, useState } from "react";
import { type Client, useApiMutation } from "#shared/api.ts";
import { ago } from "#shared/domain/quantities.ts";
import { userAgentInWords } from "#shared/domain/user-agent.ts";
import { removalsOf } from "#shared/domain/ways-in.ts";
import { NowProvider, useNow } from "#shared/now.tsx";
import { type Passkeys as Browser, usePasskeys } from "#shared/passkeys.ts";
import { Problem, problemOf } from "#shared/problem.tsx";
import { millis, plural, when } from "#shared/words.ts";
import {
  type Passkey,
  readWaysInAgain,
  useKeptPasskeys,
  useOwnerPassword,
} from "./queries.ts";

type Added =
  | { readonly _tag: "Made" }
  | { readonly _tag: "Cancelled" }
  | { readonly _tag: "Exists" }
  | { readonly _tag: "NotHere" }
  | { readonly _tag: "Refused" }
  | { readonly _tag: "Failed"; readonly message: string };

const add =
  (browser: Browser) =>
  (client: Client): Effect.Effect<Added, unknown> =>
    Effect.gen(function* () {
      const options = yield* client["sign-in"]
        .preparePasskey()
        .pipe(Effect.catchTag("NotAPasskeyOrigin", () => Effect.succeed(null)));
      if (options === null) return { _tag: "NotHere" };
      const made = yield* Effect.promise(() => browser.make(options));
      if (made._tag !== "Answered") return made;
      return yield* client["sign-in"]
        .makePasskey({ payload: made.answer })
        .pipe(
          Effect.as<Added>({ _tag: "Made" }),
          Effect.catchTag("PasskeyNotMade", () =>
            Effect.succeed<Added>({ _tag: "Refused" }),
          ),
          Effect.catchTag("PasskeyExists", () =>
            Effect.succeed<Added>({ _tag: "Exists" }),
          ),
        );
    });

type Removed =
  | { readonly _tag: "Removed" }
  | { readonly _tag: "LastWayIn" }
  | { readonly _tag: "Gone" };

const remove = (id: Passkey["id"]) => (client: Client) =>
  client["sign-in"].removePasskey({ params: { id } }).pipe(
    Effect.as<Removed>({ _tag: "Removed" }),
    Effect.catchTag("LastWayIn", () =>
      Effect.succeed<Removed>({ _tag: "LastWayIn" }),
    ),
    Effect.catchTag("NoSuchPasskey", () =>
      Effect.succeed<Removed>({ _tag: "Gone" }),
    ),
  );

const hostOf = (origin: string) => URL.parse(origin)?.host ?? origin;

const skeletonRows = 2;

/** The owner's passkeys: each where it was made, added and removed in place, never the last way in. */
export function Passkeys({ owner }: { readonly owner: boolean }) {
  return (
    <NowProvider>
      <PasskeysList owner={owner} />
    </NowProvider>
  );
}

function PasskeysList({ owner }: { readonly owner: boolean }) {
  const title = useId();
  const now = useNow();
  const browser = usePasskeys();
  const list = useKeptPasskeys(owner);
  const kept = useOwnerPassword(owner);
  const adding = useApiMutation(
    (_: undefined) => add(browser),
    async (added, queries) => {
      if (added._tag === "Made" || added._tag === "Exists") {
        await readWaysInAgain(queries);
      }
    },
  );

  const heading = (
    <Subheading level={2} id={title}>
      Passkeys
    </Subheading>
  );

  if (!owner) {
    return (
      <ListPanel aria-labelledby={title}>
        <ListPanelHead>{heading}</ListPanelHead>
        <ListPanelBody>
          <Empty>
            <EmptyTitle>
              A reader key cannot see the owner's passkeys.
            </EmptyTitle>
            <EmptyDescription>
              Passkeys are the owner's alone: sign in as the owner to list, add
              and remove them.
            </EmptyDescription>
          </Empty>
        </ListPanelBody>
      </ListPanel>
    );
  }

  const passkeys = list.data?.passkeys;
  const removable =
    passkeys === undefined || kept.data === undefined
      ? false
      : removalsOf(kept.data.source, passkeys.length).removePasskey;
  const notHere = !browser.offered || adding.data?._tag === "NotHere";

  const summary = () => {
    if (passkeys === undefined) return null;
    if (passkeys.length === 0) {
      return "None yet. A passkey signs in with this browser, a phone or a password manager: there is nothing to guess, and nothing to pause after wrong guesses.";
    }
    if (!removable && kept.data !== undefined) {
      return `${plural(passkeys.length, "passkey")}. It is the hub's only way in, so it cannot be removed until a password is set or another passkey is added.`;
    }
    return `${plural(passkeys.length, "passkey")}, newest first.`;
  };

  const addControl = () => {
    if (notHere) return null;
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={adding.isPending}
        onClick={() => adding.mutate(undefined)}
      >
        <KeyRound data-icon="inline-start" />
        {adding.isPending ? "Waiting for the browser…" : "Add a passkey"}
      </Button>
    );
  };

  const addOutcome = () => {
    if (notHere) {
      return (
        <Note className="basis-full">
          This address cannot have a passkey: a browser offers passkeys only
          over https at a host name, or on localhost, and this page is at{" "}
          {browser.address}.
        </Note>
      );
    }
    if (adding.isError) {
      return (
        <FieldNote tone="danger" className="basis-full">
          No passkey was made: {problemOf(adding.error)}
        </FieldNote>
      );
    }
    switch (adding.data?._tag) {
      case "Made":
        return <FieldNote className="basis-full">Added.</FieldNote>;
      case "Cancelled":
        return (
          <FieldNote className="basis-full">
            No passkey was made: the browser's prompt was closed.
          </FieldNote>
        );
      case "Exists":
        return (
          <FieldNote className="basis-full">
            This browser, or its password manager, holds a passkey for this hub
            already.
          </FieldNote>
        );
      case "Refused":
        return (
          <FieldNote tone="danger" className="basis-full">
            The hub did not take the passkey: the browser's answer made none.
            Add it again.
          </FieldNote>
        );
      case "Failed":
        return (
          <FieldNote tone="danger" className="basis-full">
            No passkey was made: {adding.data.message}
          </FieldNote>
        );
      default:
        return null;
    }
  };

  const body = () => {
    if (list.isError) {
      return (
        <Problem
          inside
          title="The hub could not list the passkeys."
          error={list.error}
          onRetry={() => list.refetch()}
        />
      );
    }
    if (passkeys === undefined) {
      return (
        <Table aria-label="Passkeys loading">
          <PasskeysHead />
          <TableBody>
            {Array.from({ length: skeletonRows }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have nothing else to tell them apart
              <PasskeySkeleton key={index} />
            ))}
          </TableBody>
        </Table>
      );
    }
    if (passkeys.length === 0) return null;
    return (
      <Table aria-label="Passkeys">
        <PasskeysHead />
        {passkeys.map((passkey) => (
          <PasskeyItem
            key={passkey.id}
            passkey={passkey}
            removable={removable}
            now={now}
          />
        ))}
      </Table>
    );
  };

  const empty = passkeys !== undefined && passkeys.length === 0;

  return (
    <ListPanel aria-labelledby={title}>
      <ListPanelHead alone={empty} className="min-h-13 items-center">
        <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
          {heading}
          {passkeys === undefined ? (
            list.isError ? null : (
              <Skeleton className="mt-1 w-56" />
            )
          ) : (
            <Note>{summary()}</Note>
          )}
        </div>
        {list.isError ? null : addControl()}
        {addOutcome()}
      </ListPanelHead>
      {empty ? null : <ListPanelBody>{body()}</ListPanelBody>}
      {passkeys === undefined || empty ? null : (
        <ListPanelFoot>
          <span>{plural(passkeys.length, "passkey")}</span>
          <Note>
            A passkey signs in only at the address it was made at, and is named
            for the browser that made it.
          </Note>
        </ListPanelFoot>
      )}
    </ListPanel>
  );
}

function PasskeysHead() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead scope="col">Made in</TableHead>
        <TableHead scope="col" from="md">
          Address
        </TableHead>
        <TableHead scope="col" numeric from="md">
          Made
        </TableHead>
        <TableHead scope="col" numeric from="lg">
          Last used
        </TableHead>
        <TableHead scope="col">
          <span className="sr-only">Actions</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

function PasskeyItem({
  passkey,
  removable,
  now,
}: {
  readonly passkey: Passkey;
  readonly removable: boolean;
  readonly now: number;
}) {
  const [asking, setAsking] = useState(false);
  const removing = useApiMutation(
    (_: undefined) => remove(passkey.id),
    async (_, queries) => readWaysInAgain(queries),
  );
  const words = userAgentInWords(passkey.userAgent) ?? "An unknown browser";
  const host = hostOf(passkey.origin);
  const made = millis(passkey.createdAt);
  const used = passkey.lastUsedAt === null ? null : millis(passkey.lastUsedAt);
  const usedWords = used === null ? "never used" : `used ${ago(now - used)}`;

  const refusal = () => {
    if (removing.isError) return `Not removed: ${problemOf(removing.error)}`;
    if (removing.data?._tag === "LastWayIn") {
      return "Not removed: it is the last way in now, as the password was turned off from another browser.";
    }
    return null;
  };
  const refused = refusal();

  return (
    <TableItem>
      <TableRow>
        <TableCell className="w-full max-w-0">
          <TableLabel title={passkey.userAgent}>{words}</TableLabel>
          <TableSecondary
            title={passkey.userAgent}
            className="hidden @2xl/panel:block"
          >
            {passkey.userAgent === ""
              ? "No user agent was sent"
              : passkey.userAgent}
          </TableSecondary>
          <TableSecondary className="@2xl/panel:hidden">
            {host} · {usedWords}
          </TableSecondary>
          {refused === null ? null : (
            <FieldNote tone="danger">{refused}</FieldNote>
          )}
        </TableCell>
        <TableCell from="md">{host}</TableCell>
        <TableCell numeric from="md">
          {when(made, now)}
        </TableCell>
        <TableCell numeric from="lg">
          {used === null ? (
            "Never"
          ) : (
            <span title={when(used, now)}>{ago(now - used)}</span>
          )}
        </TableCell>
        <TableCell numeric className="w-28 min-w-32">
          {!removable ? (
            <Note>The only way in</Note>
          ) : asking ? null : (
            <Button
              variant="outline"
              size="sm"
              disabled={removing.isPending}
              aria-label={`Remove the passkey made in ${words} at ${host}`}
              onClick={() => {
                removing.reset();
                setAsking(true);
              }}
            >
              {removing.isPending ? "Removing…" : "Remove"}
            </Button>
          )}
        </TableCell>
      </TableRow>
      {asking ? (
        <TableMore columns={5}>
          <Confirm
            question={`Remove the passkey made in ${words}? It no longer signs in to this hub; the browser or password manager keeps its copy until it is deleted there.`}
            confirm="Remove it"
            cancel="Keep it"
            pending={removing.isPending}
            onCancel={() => setAsking(false)}
            onConfirm={() =>
              removing.mutate(undefined, { onSettled: () => setAsking(false) })
            }
          />
        </TableMore>
      ) : null}
    </TableItem>
  );
}

function PasskeySkeleton() {
  return (
    <TableRow aria-hidden="true">
      <TableCell className="w-full max-w-0">
        <Skeleton className="h-3.5 w-36" />
        <Skeleton className="mt-2 w-3/5" />
      </TableCell>
      <TableCell from="md">
        <Skeleton className="w-24" />
      </TableCell>
      <TableCell numeric from="md">
        <Skeleton className="ml-auto w-20" />
      </TableCell>
      <TableCell numeric from="lg">
        <Skeleton className="ml-auto w-14" />
      </TableCell>
      <TableCell numeric className="w-28" />
    </TableRow>
  );
}
