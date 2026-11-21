import { hostname } from "node:os";
import { Layer } from "effect";
import { Environment } from "#02-application/interfaces/environment.ts";
import type { System } from "#03-domain/system.ts";

export const systemOf = (platform: NodeJS.Platform): System =>
  platform === "win32" || platform === "darwin" ? platform : "linux";

/** The environment this process was started with. */
export const layer: Layer.Layer<Environment> = Layer.sync(Environment, () =>
  Environment.of({
    system: systemOf(process.platform),
    variables: { ...process.env },
    hostName: hostname(),
    workingDirectory: process.cwd(),
    program: process.execPath,
  }),
);
