import { Badge } from "@cota/ui/components/badge";
import { Button } from "@cota/ui/components/button";
import { Confirm } from "@cota/ui/components/confirm";
import { Empty, EmptyDescription, EmptyTitle } from "@cota/ui/components/empty";
import { FieldNote } from "@cota/ui/components/field-note";
import { Identifier } from "@cota/ui/components/identifier";
import {
  ListPanel,
  ListPanelBody,
  ListPanelFoot,
  ListPanelHead,
} from "@cota/ui/components/list-panel";
import { Note } from "@cota/ui/components/note";
import { PoolMark } from "@cota/ui/components/pool-mark";
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
import { type ReactNode, useMemo, useState } from "react";
import { useApiMutation } from "#shared/api.ts";
import { poolHues } from "#shared/domain/hues.ts";
import { ago } from "#shared/domain/quantities.ts";
import { useNameOf } from "#shared/names.tsx";
import { NowProvider, useNow } from "#shared/now.tsx";
import { Problem, problemOf } from "#shared/problem.tsx";
import { glyphOf } from "#shared/providers.tsx";
import { counted, millis, plural, when } from "#shared/words.ts";
import { type Pool, readPoolsAgain, usePools } from "./queries.ts";

type QuotaLogin = NonNullable<Pool["quotaLogin"]>;

const providerOf: Record<QuotaLogin["provider"], string> = {
  anthropic: "Anthropic",
  chatgpt: "ChatGPT",
};

const stateWords: Record<QuotaLogin["state"], string> = {
  active: "Kept",
  expired: "Expired",
  none: "None",
};

/** Where the connect script is run, by the provider whose login it makes (`docs/specs/quota-logins/spec.md`). */
const whereToRun: Record<QuotaLogin["provider"], string> = {
  anthropic:
    "Run it from the repository's root on a Mac with Claude Code: a Claude login is connected from macOS only, for now.",
  chatgpt: "Run it from the repository's root on a machine with Codex.",
};

/** A pool's id as one word of a shell command, quoted when it holds anything but letters, digits and `._/-`. */
const shellWord = (word: string) =>
  /^[\w./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;

const skeletonRows = 3;

/** The pools that take a quota login: each one's state as the hub gives it, forgotten in place, or the command that gives one. */
export function QuotaLogins({ owner }: { readonly owner: boolean }) {
  return (
    <NowProvider>
      <QuotaLoginsList owner={owner} />
    </NowProvider>
  );
}

function QuotaLoginsList({ owner }: { readonly owner: boolean }) {
  const now = useNow();
  const nameOf = useNameOf();
  const pools = usePools();
  const all = pools.data?.pools;
  const hues = useMemo(
    () => poolHues((all ?? []).map((pool) => pool.id)),
    [all],
  );
  const taking = all?.filter((pool) => pool.quotaLogin !== null);
  const others = (all?.length ?? 0) - (taking?.length ?? 0);

  const tally = (state: QuotaLogin["state"]) =>
    taking?.filter((pool) => pool.quotaLogin?.state === state).length ?? 0;

  const summary = () => {
    if (taking === undefined || taking.length === 0) return null;
    const parts = [
      tally("active") > 0 ? `${counted(tally("active"))} kept` : null,
      tally("expired") > 0 ? `${counted(tally("expired"))} expired` : null,
      tally("none") > 0 ? `${counted(tally("none"))} without one` : null,
    ].filter((part) => part !== null);
    return `${plural(taking.length, "pool")} ${taking.length === 1 ? "takes" : "take"} a quota login: ${parts.join(", ")}.`;
  };

  const body = () => {
    if (pools.isError) {
      return (
        <Problem
          inside
          title="The hub could not list its pools."
          error={pools.error}
          onRetry={() => pools.refetch()}
        />
      );
    }
    if (taking === undefined) {
      return (
        <Table aria-label="Quota logins loading">
          <QuotaLoginsHead />
          <TableBody>
            {Array.from({ length: skeletonRows }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have nothing else to tell them apart
              <QuotaLoginSkeleton key={index} />
            ))}
          </TableBody>
        </Table>
      );
    }
    if (taking.length === 0) {
      return (
        <Empty>
          <EmptyTitle>No pool of this hub takes a quota login.</EmptyTitle>
          <EmptyDescription>
            Only a Claude or ChatGPT subscription pool does. This hub's pools
            are keyed pools, or speak OpenAI Chat Completions, and their windows
            come from a held key or the quota headers.
          </EmptyDescription>
        </Empty>
      );
    }
    return (
      <Table aria-label="Quota logins">
        <QuotaLoginsHead />
        {taking.map((pool) => (
          <QuotaLoginItem
            key={pool.id}
            pool={pool}
            owner={owner}
            now={now}
            name={nameOf("pool", pool.id)}
            mark={
              <PoolMark
                hue={hues.get(pool.id) ?? "neutral"}
                name={nameOf("pool", pool.id)}
                glyph={glyphOf(pool.provider)}
              />
            }
          />
        ))}
      </Table>
    );
  };

  return (
    <ListPanel aria-label="Quota logins">
      {pools.isError || taking?.length === 0 ? null : (
        <ListPanelHead className="min-h-13">
          {taking === undefined ? (
            <Skeleton className="w-72" />
          ) : (
            <Note>{summary()}</Note>
          )}
          {owner ? null : (
            <Note className="basis-full">
              A reader key sees each pool's quota login but cannot give or
              forget one: that is the owner's alone.
            </Note>
          )}
        </ListPanelHead>
      )}
      <ListPanelBody>{body()}</ListPanelBody>
      {taking !== undefined && taking.length > 0 ? (
        <ListPanelFoot>
          <span>{plural(taking.length, "pool")}</span>
          <Note>
            Only a Claude or ChatGPT subscription pool takes a quota login
            {others > 0
              ? `, so the hub's ${plural(others, "other pool")} ${others === 1 ? "is" : "are"} not listed`
              : ""}
            . A quota login is given with the connect script, never in the
            browser: with COTA_HUB_URL naming this hub, it signs in with Claude
            Code or Codex in a throwaway directory, gives the hub the login and
            deletes its own copy.
          </Note>
        </ListPanelFoot>
      ) : null}
    </ListPanel>
  );
}

function QuotaLoginsHead() {
  return (
    <TableHeader>
      <TableRow>
        <TableHead scope="col">Pool</TableHead>
        <TableHead scope="col" from="md">
          Provider
        </TableHead>
        <TableHead scope="col">Quota login</TableHead>
        <TableHead scope="col" numeric>
          <span className="sr-only">Actions</span>
        </TableHead>
      </TableRow>
    </TableHeader>
  );
}

/** When a quota login was given, refreshed or refused, in words. */
const timesOf = (login: QuotaLogin, now: number) => {
  const given = login.givenAt === null ? null : millis(login.givenAt);
  const refreshed =
    login.refreshedAt === null ? null : millis(login.refreshedAt);
  const expired = login.expiredAt === null ? null : millis(login.expiredAt);
  switch (login.state) {
    case "none":
      return "Its windows come from the quota headers alone.";
    case "expired":
      return expired === null
        ? "The provider refused to refresh it."
        : `The provider refused to refresh it ${ago(now - expired)}.`;
    case "active": {
      const since = given === null ? "Given" : `Given ${when(given, now)}`;
      return refreshed === null
        ? `${since}, not refreshed yet.`
        : `${since}, refreshed ${ago(now - refreshed)}.`;
    }
  }
};

function QuotaLoginItem({
  pool,
  owner,
  now,
  name,
  mark,
}: {
  readonly pool: Pool;
  readonly owner: boolean;
  readonly now: number;
  readonly name: string;
  readonly mark: ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  const forget = useApiMutation(
    (_: undefined) => (client) =>
      client.pools.forget({ params: { pool: pool.id } }),
    async (_, queries) => readPoolsAgain(queries),
  );
  const login = pool.quotaLogin;
  if (login === null) return null;
  const kept = login.state !== "none";
  const command = `bun run quota:connect ${shellWord(pool.id)}`;
  const gives = owner && login.state !== "active";
  return (
    <TableItem>
      <TableRow>
        <TableCell className="w-1/3 max-w-0 align-top @2xl/panel:w-2/5">
          <span className="flex min-w-0 items-center gap-1.75">
            {mark}
            <TableLabel title={pool.id}>{name}</TableLabel>
          </span>
          <TableSecondary className="@2xl/panel:hidden">
            {providerOf[login.provider]}
          </TableSecondary>
        </TableCell>
        <TableCell from="md" className="align-top">
          {providerOf[login.provider]}
        </TableCell>
        <TableCell className="w-3/5 max-w-0 align-top">
          <span className="flex min-w-0 items-center gap-2">
            <TableLabel>{stateWords[login.state]}</TableLabel>
            {login.state === "active" && pool.plan !== null ? (
              <Badge>{pool.plan}</Badge>
            ) : null}
          </span>
          <Note className="mt-0.5">{timesOf(login, now)}</Note>
          {gives ? (
            <span className="mt-2 flex flex-col gap-0.5">
              <Identifier
                value={command}
                label={`command that gives ${name} a quota login`}
              />
              <Note>{whereToRun[login.provider]}</Note>
            </span>
          ) : null}
          {forget.isError ? (
            <FieldNote tone="danger">
              Not forgotten: {problemOf(forget.error)}
            </FieldNote>
          ) : null}
        </TableCell>
        <TableCell numeric className="w-24 align-top">
          {owner && kept && !asking ? (
            <Button
              variant="outline"
              size="sm"
              disabled={forget.isPending}
              aria-label={`Forget the quota login of ${name}`}
              onClick={() => {
                forget.reset();
                setAsking(true);
              }}
            >
              Forget
            </Button>
          ) : null}
        </TableCell>
      </TableRow>
      {asking ? (
        <TableMore columns={4}>
          <Confirm
            question={`Forget the quota login of ${name}? The hub stops reading its quota windows until a login is given again, and they come from the quota headers alone. Forgetting is not revoking: the provider honours the login until it is revoked there.`}
            confirm="Forget it"
            cancel="Keep it"
            pending={forget.isPending}
            onCancel={() => setAsking(false)}
            onConfirm={() =>
              forget.mutate(undefined, {
                onSettled: () => setAsking(false),
              })
            }
          />
        </TableMore>
      ) : null}
    </TableItem>
  );
}

function QuotaLoginSkeleton() {
  return (
    <TableRow aria-hidden="true">
      <TableCell className="w-1/3 max-w-0 @2xl/panel:w-2/5">
        <Skeleton className="w-28" />
      </TableCell>
      <TableCell from="md">
        <Skeleton className="w-14" />
      </TableCell>
      <TableCell className="w-3/5 max-w-0">
        <Skeleton className="h-3.5 w-16" />
        <Skeleton className="mt-2 w-48" />
      </TableCell>
      <TableCell numeric className="w-24" />
    </TableRow>
  );
}
