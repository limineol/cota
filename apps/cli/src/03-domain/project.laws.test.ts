import { describe, expect, it } from "@effect/vitest";
import { Arbitrary, Effect, Option, Schema } from "effect";
import * as Project from "./project.ts";

const oneOf = <const Choices extends ReadonlyArray<string>>(choices: Choices) =>
  Arbitrary.schema(Schema.Literals(choices));

/** A path segment: letters of either case, digits, dots and dashes, never ending `.git`. */
const segment = Arbitrary.all({
  head: oneOf([
    "acme",
    "Acme",
    "API",
    "web-app",
    "x",
    "Team9",
    "a.b",
    "my.repo",
  ]),
  tail: oneOf(["", "", "-2", ".v1", "-Mobile", "_x"]),
}).pipe(Arbitrary.map(({ head, tail }) => `${head}${tail}`));

const remote = Arbitrary.all({
  host: oneOf([
    "github.com",
    "GitHub.com",
    "git.acme.internal",
    "10.0.0.2",
    "[fd00::1]",
    "gl",
  ]),
  port: oneOf(["", "", ":22", ":8443"]),
  user: oneOf(["", "git", "ci"]),
  secret: oneOf(["", "ghp_Tok3n_9x", "glpat_ABCdef_12", "p_ss_w0rd"]),
  path: Arbitrary.array(segment, { minLength: 1, maxLength: 4 }),
  suffix: oneOf(["", ".git", ".GIT", "/", ".git/", "//"]),
  scheme: oneOf(["https", "HTTPS", "http", "ssh", "Ssh", "git"]),
});

type Remote = typeof remote extends Arbitrary.Arbitrary<infer A> ? A : never;

/** Every form a remote of these parts can be written in. */
const formsOf = (parts: Remote) => {
  const path = `${parts.path.join("/")}${parts.suffix}`;
  const userInformation =
    parts.user === ""
      ? parts.secret === ""
        ? ""
        : `${parts.secret}@`
      : parts.secret === ""
        ? `${parts.user}@`
        : `${parts.user}:${parts.secret}@`;
  return [
    `${parts.scheme}://${userInformation}${parts.host}${parts.port}/${path}`,
    `${userInformation}${parts.host}:${path}`,
    `${userInformation}${parts.host}:/${path}`,
  ];
};

describe("project laws", () => {
  it.effect.prop(
    "J1: For every host, port, user information and path, the `https`, `http`, `ssh`, `git` and short forms of a remote, with or without `.git` and a trailing slash, in any case, give the same project: the path, without `.git`, lowercased.",
    { remote },
    ({ remote: parts }) =>
      Effect.sync(() => {
        const project = parts.path.join("/").toLowerCase();
        for (const form of formsOf(parts)) {
          expect([form, Project.ofRemote(form)]).toEqual([
            form,
            Option.some(project),
          ]);
        }
      }),
    { arbitrary: { runs: 1000 } },
  );

  it.effect.prop(
    "J2: A remote's user information never appears in the project read from it.",
    { remote },
    ({ remote: parts }) =>
      Effect.sync(() => {
        for (const form of formsOf(parts)) {
          const project = Project.projectOf({
            given: undefined,
            remote: Option.some(form),
            directory: "acme-api",
          });
          if (parts.secret !== "") {
            expect(project).not.toContain(parts.secret.toLowerCase());
          }
        }
      }),
    { arbitrary: { runs: 1000 } },
  );

  it("reads no project from a local path or another scheme", () => {
    for (const remote of [
      "/srv/git/acme.git",
      "../acme",
      "C:\\repos\\acme",
      "C:/repos/acme",
      "file:///srv/git/acme.git",
      "ftp://host/acme",
      "https://github.com",
      "",
    ]) {
      expect([remote, Project.ofRemote(remote)]).toEqual([
        remote,
        Option.none(),
      ]);
    }
  });

  it("names a project by COTA_PROJECT, else the remote, else the directory, cut to 200 code points", () => {
    const long = "é".repeat(250);
    expect(
      Project.projectOf({
        given: " named ",
        remote: Option.some("git@github.com:acme/api.git"),
        directory: "dir",
      }),
    ).toBe("named");
    expect(
      Project.projectOf({
        given: "",
        remote: Option.some("git@github.com:acme/api.git"),
        directory: "dir",
      }),
    ).toBe("acme/api");
    expect(
      Project.projectOf({
        given: undefined,
        remote: Option.some("/srv/git/acme.git"),
        directory: "dir",
      }),
    ).toBe("dir");
    expect(
      [
        ...Project.projectOf({
          given: long,
          remote: Option.none(),
          directory: "dir",
        }),
      ].length,
    ).toBe(Project.longestProject);
  });

  it("reads the origin remote of a repository's configuration file", () => {
    expect(
      Project.originOfConfig(
        '[core]\n\tbare = false\n[remote "upstream"]\n\turl = git@github.com:other/api.git\n[remote "origin"]\n\turl = git@github.com:Acme/API.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n',
      ),
    ).toEqual(Option.some("git@github.com:Acme/API.git"));
    expect(Project.originOfConfig("[core]\n\tbare = false\n")).toEqual(
      Option.none(),
    );
  });
});
