import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const manifests = ["apps/hub/package.json", "apps/cli/package.json"] as const;

export const notesPathOf = (version: string) => `docs/releases/${version}.md`;

const manifestVersionOf = (root: string, path: string) => {
  const manifest: unknown = JSON.parse(readFileSync(join(root, path), "utf8"));
  return typeof manifest === "object" &&
    manifest !== null &&
    "version" in manifest &&
    typeof manifest.version === "string"
    ? manifest.version
    : undefined;
};

const imageVersionOf = (root: string) =>
  readFileSync(join(root, "Dockerfile"), "utf8").match(
    /^ARG COTA_VERSION=(\S+)$/m,
  )?.[1];

/** The repository's version, and what keeps it from being released as it stands (ADR-0027). */
export const releaseOf = (root: string, tag?: string) => {
  const [first, ...others] = manifests;
  const version = manifestVersionOf(root, first);
  if (version === undefined) {
    return { version, problems: [`${first} states no version`] };
  }
  const problems: Array<string> = [];
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    problems.push(
      `${first} states the version ${version}, which is not <major>.<minor>.<patch>`,
    );
  }
  const stated = [
    ...others.map((path) => ({ path, version: manifestVersionOf(root, path) })),
    { path: "Dockerfile", version: imageVersionOf(root) },
  ];
  for (const other of stated) {
    if (other.version !== version) {
      problems.push(
        `${other.path} states the version ${other.version ?? "nowhere"}, not ${version} as ${first} does`,
      );
    }
  }
  if (!existsSync(join(root, notesPathOf(version)))) {
    problems.push(
      `${notesPathOf(version)}, the release notes of ${version}, does not exist`,
    );
  }
  if (tag !== undefined && tag !== `v${version}`) {
    problems.push(
      `the tag ${tag} is not v${version}, the version the repository states`,
    );
  }
  return { version, problems };
};

/** A release's page: its notes without their front matter and title, then its hub image by tag and digest. */
export const releasePageOf = (notes: string, image: string) =>
  `${notes
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/^\s*# .*\n/, "")
    .trim()}

## The hub image

\`\`\`text
${image}
\`\`\`
`;

if (import.meta.main) {
  const root = join(import.meta.dir, "..");
  const [command, tag, image] = Bun.argv.slice(2);
  if (
    tag === undefined ||
    !(
      (command === "check" && image === undefined) ||
      (command === "page" && image !== undefined)
    )
  ) {
    console.error(
      "usage: bun tooling/release.ts check <tag>, or page <tag> <image>",
    );
    process.exit(2);
  }
  const { version, problems } = releaseOf(root, tag);
  if (version === undefined || problems.length > 0) {
    console.error(problems.map((problem) => `release: ${problem}`).join("\n"));
    process.exit(1);
  }
  process.stdout.write(
    image === undefined
      ? `${version}\n`
      : releasePageOf(
          readFileSync(join(root, notesPathOf(version)), "utf8"),
          image,
        ),
  );
}
