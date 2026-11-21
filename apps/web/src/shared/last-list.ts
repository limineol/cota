import type { SessionsSearch } from "./sessions-search.ts";
import { validateSearch } from "./sessions-search.ts";

const key = "cota.sessions-list";

/** Keeps the sessions list's search for this tab, so a session's page leads back to the list as it was shown. */
export const rememberList = (search: SessionsSearch) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(search));
  } catch {
    return;
  }
};

/** The sessions list's search as this tab last showed it, or none. */
export const rememberedList = (): SessionsSearch => {
  try {
    const kept: unknown = JSON.parse(sessionStorage.getItem(key) ?? "{}");
    return typeof kept === "object" && kept !== null && !Array.isArray(kept)
      ? validateSearch({ ...kept })
      : {};
  } catch {
    return {};
  }
};
