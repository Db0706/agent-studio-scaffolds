#!/usr/bin/env node
// Composes every supported combination and checks it installs, typechecks, builds and passes its tests.
// Node services are also started from their build output and probed over HTTP (offline: no keys, no facilitator).
// Needs network access (npm registry) but no API keys or wallets.
//
//   npm run verify                 # whole matrix (next + node)
//   npm run verify -- node         # one framework
//   npm run verify -- full         # one combination, every framework
//   npm run verify -- node-full    # one combination, one framework

import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { compose } from "./compose.mjs";

const COMBOS = {
  base: [],
  gemini: ["gemini"],
  payments: ["payments"],
  "payments-spending": ["payments", "spending"],
  full: ["gemini", "payments", "spending", "paidapi"],
};
const MATRIX = ["next", "node"].flatMap((framework) =>
  Object.entries(COMBOS).map(([combo, modules]) => ({ framework, combo, name: `${framework}-${combo}`, modules })),
);

// Env vars that would change what the smoke test sees. They are removed so results don't depend on the machine.
const SMOKE_UNSET_ENV = ["GEMINI_API_KEY", "PAY_TO_ADDRESS", "AGENT_PRIVATE_KEY", "X402_NETWORK", "X402_FACILITATOR_URL"];

const only = process.argv.slice(2);
const results = [];

for (const { framework, combo, name, modules } of MATRIX) {
  if (only.length && !only.some((o) => o === name || o === framework || o === combo)) continue;
  const out = join("out", name);
  console.log(`\n=== ${framework} + [${modules.join(", ") || "base only"}] -> ${out}`);
  const steps = [];
  try {
    const manifest = compose({ framework, modules, out });
    const run = (label, cmd) => {
      execSync(cmd, { cwd: out, stdio: "inherit", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
      steps.push(label);
    };
    run("install", "npm install --no-audit --no-fund");
    run("typecheck", "npm run typecheck");
    run("build", "npm run build");
    if (manifest.scripts["test:spending"]) run("test:spending", "npm run test:spending");
    if (framework === "node") {
      await smokeNode(out, manifest);
      steps.push("smoke");
    }
    if (existsSync(join(out, ".env.local"))) throw new Error(".env.local must never be generated");
    results.push({ name, ok: true, steps });
  } catch (err) {
    console.error(err.message);
    results.push({ name, ok: false, steps, error: err.message.split("\n")[0] });
  }
}

console.log("\n=== Summary");
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(23)} ${r.steps.join(" → ")}${r.ok ? "" : `  (${r.error})`}`);
}
if (!results.length) {
  console.error(`No combination matches ${only.join(" ")}. Known: ${MATRIX.map((m) => m.name).join(", ")}`);
  process.exit(1);
}
if (results.some((r) => !r.ok)) process.exit(1);

/** Starts `node dist/server.js` without any keys and checks each module's endpoints answer as documented. */
async function smokeNode(dir, manifest) {
  const port = await freePort();
  const env = { ...process.env, PORT: String(port) };
  for (const key of SMOKE_UNSET_ENV) delete env[key];
  const child = spawn(process.execPath, ["dist/server.js"], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  const expect = async (label, res, status, check = () => true) => {
    const body = await res.json().catch(() => null);
    if (res.status !== status || !check(body)) {
      throw new Error(`smoke: ${label} returned ${res.status} ${JSON.stringify(body)} (expected ${status})`);
    }
    console.log(`  smoke ok: ${label} -> ${res.status}`);
  };
  try {
    await waitFor(`${base}/`, child, () => log);
    await expect("GET /", await fetch(`${base}/`), 200, (b) =>
      JSON.stringify(b?.modules?.map((m) => m.id)) === JSON.stringify(manifest.modules),
    );
    await expect("GET /does-not-exist", await fetch(`${base}/does-not-exist`), 404);
    if (manifest.modules.includes("gemini")) {
      const post = (body) => fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      await expect("POST /api/chat (empty)", await post("{}"), 400);
      await expect("POST /api/chat (malformed JSON)", await post("{"), 400);
      await expect("POST /api/chat (no key)", await post('{"prompt":"hi"}'), 500, (b) => /GEMINI_API_KEY is not set/.test(b?.error));
    }
    if (manifest.modules.includes("paidapi")) {
      await expect("GET /premium-data (no PAY_TO_ADDRESS)", await fetch(`${base}/premium-data`), 500, (b) => /PAY_TO_ADDRESS is not set/.test(b?.error));
      await expect("GET /api/buy", await fetch(`${base}/api/buy`), 200, (b) => b?.spending?.budgetUsd === "1.00");
      await expect("POST /api/buy (no AGENT_PRIVATE_KEY)", await fetch(`${base}/api/buy`, { method: "POST" }), 400, (b) => /AGENT_PRIVATE_KEY is not set/.test(b?.error));
    }
  } finally {
    child.kill();
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer().listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function waitFor(url, child, getLog) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`smoke: server exited with code ${child.exitCode}\n${getLog()}`);
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`smoke: server did not start within 10s\n${getLog()}`);
}
