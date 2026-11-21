import { Option } from "effect";

/** The longest project, in code points. */
export const longestProject = 200;

const schemeForm = /^(https?|ssh|git):\/\/([^/]*)(\/.*)?$/i;

/** `[<user>@]<host>:<path>`, where neither the user nor the host holds a `/`; a single letter before the colon is a Windows drive. */
const shortForm = /^(?:[^@/]+@)?(\[[^\]/]+\]|[^@/:[\]]{2,}):(.*)$/;

const projectOfPath = (path: string): Option.Option<string> => {
  const project = path
    .replace(/^[/~]+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .toLowerCase();
  return project === "" ? Option.none() : Option.some(project);
};

/**
 * The project of a git remote: its path after the host, without a leading
 * `/` or `~`, a trailing `/` and then `.git`, lowercased. A remote's user
 * information, which can hold a token, is never part of it. A remote that is
 * a local path, a `file://` address or has no path gives none.
 */
export const ofRemote = (remote: string): Option.Option<string> => {
  const written = remote.trim();
  const url = written.match(schemeForm);
  if (url !== null) return projectOfPath(url[3] ?? "");
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(written)) return Option.none();
  const short = written.match(shortForm);
  return short === null ? Option.none() : projectOfPath(short[2] ?? "");
};

/** The url of the `origin` remote in a repository's own configuration file (`.git/config`), when it names one. */
export const originOfConfig = (text: string): Option.Option<string> => {
  let inOrigin = false;
  for (const line of text.split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]*)\]/);
    if (section !== null) {
      inOrigin = /^\s*remote\s+"origin"\s*$/.test(section[1] ?? "");
      continue;
    }
    const url = inOrigin ? line.match(/^\s*url\s*=\s*(.*?)\s*$/) : null;
    if (url !== null) {
      const value = (url[1] ?? "").replace(/^"(.*)"$/, "$1");
      return value === "" ? Option.none() : Option.some(value);
    }
  }
  return Option.none();
};

/** What a launch knows that names its project. */
export interface Sources {
  /** `COTA_PROJECT`, when it is set. */
  readonly given: string | undefined;
  /** The `origin` remote of the repository holding the working directory, when there is one. */
  readonly remote: Option.Option<string>;
  /** The working directory's name. */
  readonly directory: string;
}

/** A launch's project: `COTA_PROJECT`, else the `origin` remote's, else the working directory's name, cut to 200 code points. */
export const projectOf = ({ given, remote, directory }: Sources): string => {
  const named = given?.trim() ?? "";
  const project =
    named !== ""
      ? named
      : Option.getOrElse(Option.flatMap(remote, ofRemote), () => directory);
  return [...project].slice(0, longestProject).join("");
};
