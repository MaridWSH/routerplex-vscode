import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  external: ["vscode"],
  format: "cjs",
  platform: "node",
  // jsonc-parser resolves to a UMD file whose internal require("./impl/format")
  // esbuild cannot rewrite, so the bundle throws MODULE_NOT_FOUND the moment
  // VS Code loads it and the participant sees a control panel that never
  // finishes loading. The ESM entry point bundles cleanly.
  mainFields: ["module", "main"],
  target: "node20",
  outfile: "dist/extension.js",
  // Source maps only while developing: the shipped VSIX travels over venue wifi
  // and through a 100 KB SSM document on the way to the console host.
  sourcemap: watch,
  minify: !watch,
  logLevel: "info",
};

/**
 * The VSIX ships dist/extension.js alone, so any require left in the bundle has
 * to resolve against node builtins or "vscode". Loading the bundle once against
 * a stub host is the only check that catches a dependency esbuild inlined but
 * could not fully rewrite.
 */
async function assertBundleLoads(outfile) {
  const script = `
    const Module = require("node:module");
    const load = Module._load;
    Module._load = function (request) {
      if (request === "vscode") {
        return new Proxy(
          { EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } } },
          { get: (target, key) => (key in target ? target[key] : new Proxy(() => ({ dispose() {} }), { get: () => () => ({ dispose() {} }) })) },
        );
      }
      return load.apply(this, arguments);
    };
    const bundle = require(process.argv[1]);
    if (typeof bundle.activate !== "function") throw new Error("The bundle does not export activate().");
  `;
  try {
    await promisify(execFile)(process.execPath, ["-e", script, path.resolve(outfile)]);
  } catch (error) {
    const stderr = String(error.stderr || error.message);
    const detail = stderr.split("\n").find((line) => /^\s*(Error|[A-Za-z]*Error):/.test(line)) ?? stderr.slice(0, 400);
    throw new Error(`${outfile} cannot be loaded by the extension host:\n${detail}`);
  }
}

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
} else {
  await esbuild.build(options);
  await assertBundleLoads(options.outfile);
  console.log(`  ${options.outfile} loads against a stub extension host`);
}
