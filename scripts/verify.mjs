#!/usr/bin/env node
// Composes every supported combination and checks it installs, typechecks, builds and passes its tests.
// Needs network access (npm registry) but no API keys or wallets.
//
//   npm run verify                 # whole matrix
//   npm run verify -- full         # just one combination by name

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { compose } from "./compose.mjs";

const MATRIX = {
  base: [],
  gemini: ["gemini"],
  payments: ["payments"],
  "payments-spending": ["payments", "spending"],
  full: ["gemini", "payments", "spending", "paidapi"],
};

const only = process.argv.slice(2);
const results = [];

for (const [name, modules] of Object.entries(MATRIX)) {
  if (only.length && !only.includes(name)) continue;
  const out = join("out", `next-${name}`);
  console.log(`\n=== next + [${modules.join(", ") || "base only"}] -> ${out}`);
  const steps = [];
  try {
    const manifest = compose({ framework: "next", modules, out });
    const run = (label, cmd) => {
      execSync(cmd, { cwd: out, stdio: "inherit", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
      steps.push(label);
    };
    run("install", "npm install --no-audit --no-fund");
    run("typecheck", "npm run typecheck");
    run("build", "npm run build");
    if (manifest.scripts["test:spending"]) run("test:spending", "npm run test:spending");
    if (existsSync(join(out, ".env.local"))) throw new Error(".env.local must never be generated");
    results.push({ name, ok: true, steps });
  } catch (err) {
    results.push({ name, ok: false, steps, error: err.message.split("\n")[0] });
  }
}

console.log("\n=== Summary");
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(18)} ${r.steps.join(" → ")}${r.ok ? "" : `  (${r.error})`}`);
}
if (results.some((r) => !r.ok)) process.exit(1);
