import { join, posix } from "node:path";
import { Glob } from "bun";

const mayImport: Record<string, ReadonlyArray<string>> = {
  "@cota/cli": ["@cota/hub/api", "@cota/hub/harness", "@cota/hub/shim"],
  "@cota/hub": [],
  "@cota/proofs": ["@cota/hub"],
  "@cota/ui": [],
  "@cota/web": ["@cota/ui", "@cota/hub/api"],
};

const domainFolder =
  /^apps\/(?:hub\/src\/(?:modules\/[^/]+|shared)\/03-domain|cli\/src\/03-domain|web\/src\/shared\/domain)\//;

/** Exports of a package that only tests may import. */
const testOnlyExports = ["@cota/hub/harness"];
const inProcessEffectModules = [
  "Schema",
  "Option",
  "Result",
  "DateTime",
  "Duration",
  "HashMap",
  "HashSet",
  "Array",
  "Order",
  "Equal",
  "Data",
  "Match",
  "Predicate",
  "Function",
  "Effect",
  "Context",
  "Layer",
  "Ref",
  "Clock",
  "Redacted",
  "Fiber",
];

const hubSource = "apps/hub/src/";
const webSource = "apps/web/src/";
const cliSource = "apps/cli/src/";
const cliRoot = ["main.ts", "cli.ts"];

const layers = [
  "01-presentation",
  "02-application",
  "03-domain",
  "04-infrastructure",
  "05-tests",
];

const layerMayImport: Record<string, ReadonlyArray<string>> = {
  "01-presentation": ["01-presentation", "02-application", "03-domain"],
  "02-application": ["02-application", "03-domain"],
  "03-domain": ["03-domain"],
  "04-infrastructure": ["04-infrastructure", "02-application", "03-domain"],
};

const root = process.argv[2] ?? join(import.meta.dir, "..");

interface Workspace {
  readonly name: string;
  readonly dir: string;
  readonly exports: ReadonlyArray<string>;
}

interface Import {
  readonly specifier: string;
  readonly clause: string;
}

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  Bun.file(join(root, path)).json();

const workspacesOf = async (): Promise<ReadonlyArray<Workspace>> => {
  const { workspaces } = await readJson("package.json");
  const patterns = Array.isArray(workspaces) ? workspaces.map(String) : [];
  const manifests = patterns.flatMap((pattern) => [
    ...new Glob(`${pattern}/package.json`).scanSync(root),
  ]);
  return Promise.all(
    manifests.map(async (manifest) => {
      const { name, exports } = await readJson(manifest);
      return {
        name: String(name),
        dir: manifest.slice(0, -"/package.json".length),
        exports:
          typeof exports === "object" && exports !== null
            ? Object.keys(exports)
            : [],
      };
    }),
  );
};

const typeScriptFiles = (dir: string) =>
  [...new Glob(`${dir}/**/*.{ts,tsx,mts,cts}`).scanSync(root)].filter(
    (file) => !file.includes("node_modules/"),
  );

const staticImport =
  /^\s*(?:import|export)\s+([^;=]*?)\s*from\s*["']([^"']+)["']/gm;
const sideEffectImport = /^\s*import\s*["']([^"']+)["']/gm;
const dynamicImport = /\bimport\(\s*["']([^"']+)["']\s*\)/g;

const importsOf = (source: string): ReadonlyArray<Import> => [
  ...Array.from(
    source.matchAll(staticImport),
    ([, clause = "", specifier = ""]) => ({
      specifier,
      clause,
    }),
  ),
  ...Array.from(source.matchAll(sideEffectImport), ([, specifier = ""]) => ({
    specifier,
    clause: "",
  })),
  ...Array.from(source.matchAll(dynamicImport), ([, specifier = ""]) => ({
    specifier,
    clause: "*",
  })),
];

const namedImports = (clause: string) =>
  (clause.match(/\{([^}]*)\}/)?.[1] ?? "")
    .split(",")
    .map(
      (binding) =>
        binding
          .replace(/^\s*type\s+/, "")
          .trim()
          .split(/\s+/)[0] ?? "",
    )
    .filter((name) => name !== "");

const importsWholeModule = (clause: string) =>
  clause.includes("*") || /^(?:type\s+)?\w+\s*(?:,|$)/.test(clause);

const climbs = (specifier: string) =>
  specifier.startsWith(".") && specifier.split("/").includes("..");

const workspacePackage = (specifier: string) =>
  specifier.startsWith("@cota/")
    ? specifier.split("/").slice(0, 2).join("/")
    : undefined;

const isDomainFile = (file: string) =>
  domainFolder.test(file) && !file.endsWith(".test.ts");

const domainProblem = ({ specifier, clause }: Import): string | undefined => {
  const allowed = `the domain imports from Effect only modules that stay inside the process: ${inProcessEffectModules.join(", ")} (ADR-0003)`;
  if (specifier.startsWith(".") || specifier.startsWith("#")) return undefined;
  if (specifier === "effect") {
    if (importsWholeModule(clause)) {
      return `imports all of "effect", and ${allowed}`;
    }
    const others = namedImports(clause).filter(
      (name) => !inProcessEffectModules.includes(name),
    );
    if (others.length === 0) return undefined;
    return `imports ${others.join(", ")} from "effect", and ${allowed}`;
  }
  if (specifier.startsWith("effect/")) {
    const module = specifier.slice("effect/".length);
    if (inProcessEffectModules.includes(module)) return undefined;
    return `imports "${specifier}", and ${allowed}`;
  }
  if (workspacePackage(specifier) !== undefined) return undefined;
  return `imports "${specifier}", and ${allowed}`;
};

const matchesExport = (entry: string, subpath: string) => {
  const [prefix = "", suffix] = entry.split("*");
  return suffix === undefined
    ? entry === subpath
    : subpath.startsWith(prefix) &&
        subpath.endsWith(suffix) &&
        subpath.length > prefix.length + suffix.length;
};

const workspaceProblem = (
  from: Workspace,
  { specifier }: Import,
  workspaces: ReadonlyArray<Workspace>,
): string | undefined => {
  const target = workspacePackage(specifier);
  if (target === undefined || target === from.name) return undefined;
  const allowed = mayImport[from.name] ?? [];
  const subpaths = allowed.filter((entry) => entry.startsWith(`${target}/`));
  if (!allowed.includes(target)) {
    if (subpaths.length === 0) {
      return `imports "${specifier}", and ${from.name} may not import ${target} (ADR-0002)`;
    }
    if (!subpaths.includes(specifier)) {
      return `imports "${specifier}", and ${from.name} may import of ${target} only ${subpaths.join(", ")} (ADR-0002)`;
    }
  }
  const subpath = `.${specifier.slice(target.length)}`;
  const exported =
    workspaces.find(({ name }) => name === target)?.exports ?? [];
  if (!exported.some((entry) => matchesExport(entry, subpath))) {
    return `imports "${specifier}", which ${target} does not export: import one of its concepts, ${exported.join(", ")} (ADR-0002)`;
  }
  return undefined;
};

interface Place {
  readonly area: "modules" | "shared" | "lib" | "root" | "other";
  readonly module: string;
  readonly folder: string;
  readonly inside: string;
}

const placeOf = (path: string): Place => {
  const [top = "", ...rest] = path.split("/");
  if (top === "modules") {
    const [module = "", folder = "", ...inside] = rest;
    return { area: "modules", module, folder, inside: inside.join("/") };
  }
  if (top === "shared") {
    const [folder = "", ...inside] = rest;
    return { area: "shared", module: "", folder, inside: inside.join("/") };
  }
  const area =
    top === "lib"
      ? "lib"
      : top === "config" ||
          path === "hub.ts" ||
          path === "main.ts" ||
          path === "api.ts" ||
          path === "restore-archive.ts" ||
          path === "import.ts"
        ? "root"
        : "other";
  return { area, module: "", folder: "", inside: rest.join("/") };
};

const isModuleFile = ({ area, folder, inside }: Place) =>
  area === "modules" && folder === "module.ts" && inside === "";

const isExempt = (path: string, place: Place) =>
  path.endsWith(".test.ts") ||
  path.split("/").includes("05-tests") ||
  isModuleFile(place) ||
  place.area === "root";

const placementProblem = (place: Place): string | undefined => {
  const holds =
    "holds module.ts and the layer folders 01-presentation, 02-application, 03-domain, 04-infrastructure and 05-tests, so that every file falls under the layer rules";
  if (place.area === "modules" && !isModuleFile(place)) {
    if (place.inside === "") {
      return `is directly in the module ${place.module}, which ${holds}: move it into its layer`;
    }
    if (!layers.includes(place.folder)) {
      return `is under "${place.folder}", which is not a layer: a module ${holds}`;
    }
  }
  if (place.area === "shared" && !layers.includes(place.folder)) {
    return place.inside === ""
      ? "is directly in shared, which holds only layer folders: move it into its layer"
      : `is under "${place.folder}", which is not a layer: shared holds only the layer folders 01-presentation to 05-tests`;
  }
  if (
    place.folder === "02-application" &&
    !/^(?:commands|queries|interfaces)\//.test(place.inside)
  ) {
    return "is in 02-application but not under commands, queries or interfaces, which hold its use cases and ports: a value or rule they share goes in 03-domain, and an adapter in 04-infrastructure";
  }
  return undefined;
};

const isHttp = (specifier: string) =>
  specifier === "effect/http" || specifier.startsWith("effect/http/");

const httpProblem = (
  path: string,
  { specifier }: Import,
): string | undefined => {
  const { area, folder } = placeOf(path);
  if (area !== "modules" && area !== "shared") return undefined;
  if (folder !== "02-application" && folder !== "03-domain") return undefined;
  if (path.endsWith(".test.ts") || !isHttp(specifier)) return undefined;
  return `imports "${specifier}", and ${folder} speaks its module's own terms: HTTP's types stay in 01-presentation and 04-infrastructure, and a value the module needs from them, such as a method, is its own in 03-domain`;
};

const targetOf = (path: string, specifier: string): string | undefined => {
  if (specifier.startsWith("#")) return specifier.slice(1);
  if (specifier.startsWith("./")) {
    return posix.join(posix.dirname(path), specifier);
  }
  return undefined;
};

const withinProblem = (
  imports: string,
  where: string,
  from: string,
  to: string,
): string | undefined => {
  const allowed = layerMayImport[from];
  if (allowed === undefined || allowed.includes(to)) return undefined;
  if (to !== "module.ts" && !layers.includes(to)) return undefined;
  return `${imports}, and in ${where}, ${from} may import only ${allowed.join(", ")}, not ${to === "05-tests" ? "05-tests, which only tests import" : to}`;
};

const layerProblem = (
  path: string,
  { specifier }: Import,
): string | undefined => {
  const from = placeOf(path);
  if (isExempt(path, from)) return undefined;
  const target = targetOf(path, specifier);
  if (target === undefined) return undefined;
  const to = placeOf(target);
  const imports = `imports "${specifier}"`;
  if (from.area !== "other" && to.area === "root") {
    return `${imports}, which is the composition root: config/, hub.ts, main.ts, api.ts, restore-archive.ts and import.ts assemble modules, shared and lib, which never import them; take what they give as an argument or a service`;
  }
  if (from.area === "lib") {
    if (to.area === "lib") return undefined;
    return `${imports}, and lib knows nothing of Cota: it imports only lib and outside packages; move the file out of lib, or give lib what it needs as an argument`;
  }
  if (from.area === "shared") {
    if (to.area === "modules") {
      return `${imports}, and shared imports no module: move what both need into shared`;
    }
    if (to.area === "shared") {
      return withinProblem(imports, "shared", from.folder, to.folder);
    }
    return undefined;
  }
  if (from.area !== "modules") return undefined;
  if (to.area === "shared" && to.folder === "05-tests") {
    return `${imports}, which is shared's test support: only tests and 05-tests import 05-tests`;
  }
  if (to.area !== "modules") return undefined;
  if (to.module !== from.module) {
    if (
      to.folder === "02-application" &&
      /^(?:commands|queries)\//.test(to.inside)
    ) {
      return undefined;
    }
    return `${imports}, which is inside the module ${to.module}: another module may import only its 02-application/commands and 02-application/queries; ask it through a command or query, or move a type both need to shared/03-domain`;
  }
  return withinProblem(
    imports,
    `the module ${from.module}`,
    from.folder,
    to.folder,
  );
};

const isCliExempt = (path: string) =>
  path.endsWith(".test.ts") ||
  path.startsWith("05-tests/") ||
  cliRoot.includes(path);

const cliPlacementProblem = (path: string): string | undefined => {
  if (path.endsWith(".test.ts") || cliRoot.includes(path)) return undefined;
  const [folder = "", ...inside] = path.split("/");
  if (!layers.includes(folder)) {
    return `is not under a layer: the CLI's src holds ${cliRoot.join(" and ")} and the layer folders 01-presentation to 05-tests, so that every file falls under the layer rules`;
  }
  if (
    folder === "02-application" &&
    !/^(?:commands|queries|interfaces)\//.test(inside.join("/"))
  ) {
    return "is in 02-application but not under commands, queries or interfaces, which hold its use cases and ports: a value or rule they share goes in 03-domain, and an adapter in 04-infrastructure";
  }
  return undefined;
};

const cliProblem = (
  path: string,
  { specifier }: Import,
): string | undefined => {
  const [from = ""] = path.split("/");
  const imports = `imports "${specifier}"`;
  if (
    (from === "02-application" || from === "03-domain") &&
    isHttp(specifier) &&
    !path.endsWith(".test.ts")
  ) {
    return `${imports}, and ${from} speaks the CLI's own terms: HTTP's types stay in 01-presentation and 04-infrastructure`;
  }
  if (isCliExempt(path)) return undefined;
  const target = targetOf(path, specifier);
  if (target === undefined) return undefined;
  if (cliRoot.includes(target)) {
    return `${imports}, which is the CLI's composition root: ${cliRoot.join(" and ")} assemble the layers, which never import them`;
  }
  const [to = ""] = target.split("/");
  return withinProblem(imports, "the CLI", from, to);
};

type WebArea = "app" | "shared" | "stories" | "root" | `screens/${string}`;

const webAreaOf = (path: string): WebArea => {
  const [top = "", screen = ""] = path.split("/");
  if (top === "screens") return `screens/${screen}`;
  if (top === "app" || top === "shared" || top === "stories") return top;
  return "root";
};

const isStoryOrTest = (path: string) => /\.(?:stories|test)\.tsx?$/.test(path);

const webDomainProblem = (
  path: string,
  { specifier }: Import,
): string | undefined => {
  if (!path.startsWith("shared/domain/") || isStoryOrTest(path)) {
    return undefined;
  }
  const target = targetOf(path, specifier);
  const inside =
    target === undefined
      ? workspacePackage(specifier) === undefined
      : target.startsWith("shared/domain/");
  if (inside) return undefined;
  return `imports "${specifier}", and the web's domain imports only itself and Effect's modules that stay inside the process: no React, no DOM, no API (ADR-0019)`;
};

const webProblem = (
  path: string,
  { specifier }: Import,
): string | undefined => {
  const target = targetOf(path, specifier);
  if (target === undefined) return undefined;
  const from = webAreaOf(path);
  const to = webAreaOf(target);
  if (from === to || from === "root" || from === "stories") return undefined;
  const imports = `imports "${specifier}"`;
  if (to === "stories") {
    if (isStoryOrTest(path)) return undefined;
    return `${imports}, which is story support: only stories and tests import it (ADR-0019)`;
  }
  if (from === "app" || to === "shared") return undefined;
  if (from === "shared") {
    return `${imports}, and shared never imports the app or a screen: move what both need into shared (ADR-0019)`;
  }
  return `${imports}, and a screen imports only itself, #shared and @cota/ui, never the app or another screen: move what both need into shared (ADR-0019)`;
};

const workspaces = await workspacesOf();

const problemOf = (
  file: string,
  workspace: Workspace | undefined,
  imported: Import,
): string | undefined => {
  if (climbs(imported.specifier)) {
    return `imports "${imported.specifier}", which climbs out of its folder: reach a sibling folder through a # import, and another package through its exports (ADR-0002)`;
  }
  if (workspace === undefined) return undefined;
  if (isDomainFile(file)) {
    const problem = domainProblem(imported);
    if (problem !== undefined) return problem;
  }
  if (file.startsWith(hubSource)) {
    const path = file.slice(hubSource.length);
    const problem = httpProblem(path, imported) ?? layerProblem(path, imported);
    if (problem !== undefined) return problem;
  }
  if (file.startsWith(webSource)) {
    const path = file.slice(webSource.length);
    const problem =
      webDomainProblem(path, imported) ?? webProblem(path, imported);
    if (problem !== undefined) return problem;
  }
  if (file.startsWith(cliSource)) {
    const problem = cliProblem(file.slice(cliSource.length), imported);
    if (problem !== undefined) return problem;
  }
  if (
    testOnlyExports.includes(imported.specifier) &&
    !file.endsWith(".test.ts") &&
    !file.split("/").includes("05-tests")
  ) {
    return `imports "${imported.specifier}", which only tests and 05-tests import`;
  }
  return workspaceProblem(workspace, imported, workspaces);
};

const problems = workspaces
  .filter(({ name }) => !(name in mayImport))
  .map(
    ({ name, dir }) =>
      `${dir}/package.json: ${name} has no row in tooling/boundaries.ts; add it before its first file (ADR-0002)`,
  );

const files = [
  ...workspaces.flatMap((workspace) =>
    typeScriptFiles(workspace.dir).map((file) => ({ file, workspace })),
  ),
  ...[
    ...new Glob("*.{ts,mts,cts}").scanSync(root),
    ...typeScriptFiles("tooling"),
  ].map((file) => ({ file, workspace: undefined })),
];

for (const { file, workspace } of files) {
  if (file.startsWith(hubSource)) {
    const path = file.slice(hubSource.length);
    const place = placeOf(path);
    const problem = path.endsWith(".test.ts")
      ? undefined
      : placementProblem(place);
    if (problem !== undefined) problems.push(`${file}: ${problem}`);
  }
  if (file.startsWith(cliSource)) {
    const problem = cliPlacementProblem(file.slice(cliSource.length));
    if (problem !== undefined) problems.push(`${file}: ${problem}`);
  }
  const source = await Bun.file(join(root, file)).text();
  for (const imported of importsOf(source)) {
    const problem = problemOf(file, workspace, imported);
    if (problem !== undefined) problems.push(`${file}: ${problem}`);
  }
}

if (problems.length > 0) {
  console.error(problems.sort().join("\n"));
  process.exit(1);
}
console.log(`boundaries: ${files.length} files, no crossings`);
