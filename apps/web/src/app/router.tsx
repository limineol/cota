import { createRouter, type RouterHistory } from "@tanstack/react-router";
import { routeTree } from "#route-tree.gen.ts";

/** A query string's parameters, a repeated one as the list of its values and any other as its one string. */
const parseSearch = (search: string): Record<string, unknown> => {
  const params = new URLSearchParams(search);
  return Object.fromEntries(
    [...new Set(params.keys())].map((key) => {
      const values = params.getAll(key);
      return [key, values.length === 1 ? values[0] : values];
    }),
  );
};

/** Writes a list as one parameter per value and anything else as its string, so a link reads `?pool=work&pool=personal`. */
const stringifySearch = (search: Record<string, unknown>): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    for (const each of Array.isArray(value) ? value : [value]) {
      if (each !== undefined) params.append(key, String(each));
    }
  }
  const written = params.toString();
  return written === "" ? "" : `?${written}`;
};

export const makeRouter = (history?: RouterHistory) =>
  createRouter({
    routeTree,
    parseSearch,
    stringifySearch,
    ...(history === undefined ? {} : { history }),
  });

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
}
