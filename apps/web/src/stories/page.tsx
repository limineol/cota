import type { Decorator, StoryObj } from "@storybook/react-vite";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  type ParsedLocation,
  RouterProvider,
} from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { makeQueryClient } from "#app/query-client.ts";
import { makeRouter } from "#app/router.tsx";
import { ApiCaller } from "#shared/api.ts";
import { type Passkeys, PasskeysOfTheBrowser } from "#shared/passkeys.ts";
import { type Fixture, fakeCaller } from "./fake-api.ts";
import { standIn } from "./passkeys.ts";

function Api({
  fixtures,
  passkeys = standIn(),
  children,
}: {
  readonly fixtures: ReadonlyArray<Fixture>;
  readonly passkeys?: Passkeys;
  readonly children: ReactNode;
}) {
  const [api] = useState(() => ({
    caller: fakeCaller(fixtures),
    queryClient: makeQueryClient({ retry: false }),
  }));
  return (
    <ApiCaller value={api.caller}>
      <PasskeysOfTheBrowser value={passkeys}>
        <QueryClientProvider client={api.queryClient}>
          {children}
        </QueryClientProvider>
      </PasskeysOfTheBrowser>
    </ApiCaller>
  );
}

let shown: { readonly location: () => ParsedLocation } | null = null;

/** Where the page story drawn last has gone, as its router holds it. */
export const locationShown = (): ParsedLocation => {
  if (shown === null) throw new Error("No page story has been drawn.");
  return shown.location();
};

function Page({
  path,
  fixtures,
  passkeys,
}: {
  readonly path: string;
  readonly fixtures: ReadonlyArray<Fixture>;
  readonly passkeys: Passkeys | undefined;
}) {
  const [router] = useState(() =>
    makeRouter(createMemoryHistory({ initialEntries: [path] })),
  );
  useEffect(() => {
    shown = { location: () => router.state.location };
  }, [router]);
  return (
    <Api fixtures={fixtures} {...(passkeys === undefined ? {} : { passkeys })}>
      <RouterProvider router={router} />
    </Api>
  );
}

/** A story of the whole app at a path, whose API answers from fixtures, in a browser that `passkeys` stands in for. */
export const page = (
  path: string,
  fixtures: ReadonlyArray<Fixture>,
  passkeys?: Passkeys,
): StoryObj => ({
  tags: ["page"],
  render: () => <Page path={path} fixtures={fixtures} passkeys={passkeys} />,
});

/** A decorator for a story of something that calls the API, which answers from fixtures. */
export const withApi =
  (fixtures: ReadonlyArray<Fixture>, passkeys?: Passkeys): Decorator =>
  (Story) => (
    <Api fixtures={fixtures} {...(passkeys === undefined ? {} : { passkeys })}>
      <Story />
    </Api>
  );
