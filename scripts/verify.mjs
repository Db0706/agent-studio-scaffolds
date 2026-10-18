#!/usr/bin/env node
// Composes every supported combination and checks it installs, typechecks, builds and passes its tests.
// Node services and python agents are also started and probed over HTTP (offline: no keys, no facilitator).
// Expo apps are checked against their SDK's expected native module versions, bundled for Android
// (`expo export`) and scanned for secrets; their companion server gets the full node treatment.
// Needs network access (npm registry, PyPI) but no API keys or wallets.
// Python combinations use $PYTHON (default python3), which must be 3.10 or newer.
//
//   npm run verify                 # whole matrix (next + node + python + expo)
//   npm run verify -- node         # one framework
//   npm run verify -- full         # one combination, every framework
//   npm run verify -- node-full    # one combination, one framework

import { execSync, spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { compose } from "./compose.mjs";

const COMBOS = {
  base: [],
  gemini: ["gemini"],
  payments: ["payments"],
  "payments-spending": ["payments", "spending"],
  full: ["gemini", "payments", "spending", "paidapi", "paysh"],
  "full-wallet": ["gemini", "payments", "spending", "paidapi", "paysh", "wallet"],
};
// Combinations that only some frameworks have modules for.
const ONLY = { "full-wallet": ["next"] };
const MATRIX = ["next", "node", "python", "expo"].flatMap((framework) =>
  Object.entries(COMBOS)
    .filter(([combo]) => !ONLY[combo] || ONLY[combo].includes(framework))
    .map(([combo, modules]) => ({ framework, combo, name: `${framework}-${combo}`, modules })),
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
    if (framework === "python") {
      const run = (label, cmd) => {
        execSync(cmd, { cwd: out, stdio: "inherit", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
        steps.push(label);
      };
      await verifyPython(out, manifest, run, steps);
      results.push({ name, ok: true, steps });
      continue;
    }
    await checkProject(out, framework, manifest, steps);
    if (manifest.companion) {
      // The companion server is a separate project with its own install, build and tests.
      const dir = join(out, manifest.companion.dir);
      const companionManifest = JSON.parse(readFileSync(join(dir, "studio.manifest.json"), "utf8"));
      await checkProject(dir, manifest.companion.framework, companionManifest, steps, "companion:");
    }
    results.push({ name, ok: true, steps });
  } catch (err) {
    console.error(err.message);
    results.push({ name, ok: false, steps, error: err.message.split("\n")[0] });
  }
}

console.log("\n=== Summary");
for (const r of results) {
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(25)} ${r.steps.join(" → ")}${r.ok ? "" : `  (${r.error})`}`);
}
if (!results.length) {
  console.error(`No combination matches ${only.join(" ")}. Known: ${MATRIX.map((m) => m.name).join(", ")}`);
  process.exit(1);
}
if (results.some((r) => !r.ok)) process.exit(1);

async function checkProject(dir, framework, manifest, steps, prefix = "") {
  const run = (label, cmd, env = {}) => {
    execSync(cmd, { cwd: dir, stdio: "inherit", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1", ...env } });
    steps.push(prefix + label);
  };
  run("install", "npm install --no-audit --no-fund");
  if (framework === "expo") {
    checkExpoVersions(dir, manifest);
    steps.push(prefix + "sdk-versions");
  }
  run("typecheck", "npm run typecheck");
  // EXPO_NO_TELEMETRY / CI keep `expo export` quiet and non-interactive.
  run("build", "npm run build", { EXPO_NO_TELEMETRY: "1", CI: "1" });
  if (manifest.scripts["test:spending"]) run("test:spending", "npm run test:spending");
  if (manifest.scripts["test:paysh"]) run("test:paysh", "npm run test:paysh");
  if (framework === "node") {
    await smokeNode(dir, manifest);
    steps.push(prefix + "smoke");
  }
  if (framework === "expo") {
    checkBundleHasNoSecrets(join(dir, "dist"));
    steps.push(prefix + "no-secrets");
  }
  if (framework === "next") {
    // Everything under .next/static is downloaded by every visitor's browser.
    checkBundleHasNoSecrets(join(dir, ".next", "static"));
    steps.push(prefix + "no-secrets");
  }
  if (existsSync(join(dir, ".env.local"))) throw new Error(".env.local must never be generated");
}

/**
 * Every pinned dependency that the Expo SDK also lists (bundledNativeModules.json in the installed
 * `expo` package) must be inside the SDK's range. Unlike `expo install --check`, this needs no network
 * and doesn't fail when a newer patch is published.
 */
function checkExpoVersions(dir, manifest) {
  const expected = JSON.parse(readFileSync(join(dir, "node_modules/expo/bundledNativeModules.json"), "utf8"));
  const pinned = { ...manifest.dependencies, ...manifest.devDependencies };
  const wrong = Object.entries(pinned)
    .filter(([name, version]) => expected[name] && !satisfies(version, expected[name]))
    .map(([name, version]) => `${name}@${version} (SDK expects ${expected[name]})`);
  if (wrong.length) throw new Error(`Not the versions this Expo SDK expects: ${wrong.join(", ")}`);
  console.log(`  sdk-versions ok: ${Object.keys(pinned).filter((n) => expected[n]).length} pins match expo's bundledNativeModules.json`);
}

/** Minimal semver check for the range forms bundledNativeModules.json uses: exact, ~x.y.z, ^x.y.z. */
function satisfies(version, range) {
  const parse = (v) => v.replace(/^[~^]/, "").split("-")[0].split(".").map(Number);
  const [a, b, c] = parse(version);
  const [x, y, z] = parse(range);
  const atLeast = a > x || (a === x && (b > y || (b === y && c >= z)));
  if (range.startsWith("~")) return a === x && b === y && c >= z;
  if (range.startsWith("^")) return a === x && atLeast;
  return a === x && b === y && c === z;
}

/** Anything in an app bundle can be extracted by whoever installs it, so no secret (or secret-handling code) may be in it. */
function checkBundleHasNoSecrets(distDir) {
  const FORBIDDEN = ["GEMINI_API_KEY", "AGENT_PRIVATE_KEY", "@google/genai", "createKeyPairSignerFromBytes", "companion-server/src"];
  const files = (function walk(d) {
    return readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  })(distDir);
  for (const file of files) {
    const text = readFileSync(file, "latin1");
    const hit = FORBIDDEN.find((s) => text.includes(s));
    if (hit) throw new Error(`no-secrets: ${file} contains "${hit}"`);
  }
  console.log(`  no-secrets ok: ${files.length} exported files contain none of ${FORBIDDEN.join(", ")}`);
}

/**
 * Python: venv → pip install (requirements-dev.txt pulls in requirements.txt) → compileall + pyright
 * → unittest → `python -m agent` runs → HTTP smoke test of `python -m agent serve`.
 */
async function verifyPython(out, manifest, run, steps) {
  const python = process.env.PYTHON || "python3";
  const version = execSync(`${python} -c "import sys; print('%d.%d' % sys.version_info[:2])"`).toString().trim();
  const [major, minor] = version.split(".").map(Number);
  if (major < 3 || (major === 3 && minor < 10)) throw new Error(`${python} is Python ${version}; set PYTHON to Python 3.10 or newer`);
  const venvPython = join(out, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const py = (args) => `"${resolve(venvPython)}" ${args}`;
  run("venv", `${python} -m venv .venv`);
  run("install", py("-m pip install --disable-pip-version-check -q -r requirements-dev.txt"));
  run("compile", py("-m compileall -q agent tests"));
  run("typecheck", py("-m pyright"));
  run("test", py(manifest.scripts.test.replace(/^python /, "")));
  run("cli", py("-m agent"));
  if (existsSync(join(out, ".env"))) throw new Error(".env must never be generated");
  await smokeHttp(out, manifest, resolve(venvPython), ["-m", "agent", "serve"]);
  steps.push("smoke");
}

/** Starts `node dist/server.js` without any keys and checks each module's endpoints answer as documented. */
async function smokeNode(dir, manifest) {
  return smokeHttp(dir, manifest, process.execPath, ["dist/server.js"]);
}

/** Starts the service without any keys and checks each module's endpoints answer as documented. */
async function smokeHttp(dir, manifest, command, args) {
  const port = await freePort();
  const env = { ...process.env, PORT: String(port) };
  for (const key of SMOKE_UNSET_ENV) delete env[key];
  const child = spawn(command, args, { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
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
  for (let i = 0; i < 200; i++) {
    if (child.exitCode !== null) throw new Error(`smoke: server exited with code ${child.exitCode}\n${getLog()}`);
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`smoke: server did not start within 20s\n${getLog()}`);
}
