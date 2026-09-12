// Bundles the TypeScript smoke test with esbuild, then runs it under Node.
// Avoids a ts-node style runtime dependency for a single dev script.
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const out = join(mkdtempSync(join(tmpdir(), "lab-smoke-")), "smoke.mjs");

await build({
  entryPoints: ["scripts/engine-smoke.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: out,
  logLevel: "warning",
});

await import(pathToFileURL(out).href);
