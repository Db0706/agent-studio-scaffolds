# Agent Studio scaffolds

Composable starter templates for **Superteam Agent Studio**'s Project Builder. Each template is a **base** app plus optional **modules**. A small composer (`scripts/compose.mjs`) merges them into a project a student can `npm install && npm run dev` (or, for Python, `pip install -r requirements.txt && python -m agent`).

> Students: you don't need this repo. Use the README inside your generated project.
> Maintainers and the Agent Studio generator: read on.

## Status

| Framework | Layer | Status |
| --- | --- | --- |
| Next.js 16 (App Router, TS) | `base` | ✅ builds |
| | `gemini`: Google Gen AI SDK, server route | ✅ builds; live call needs a key (not tested) |
| | `payments`: x402 V2, Solana devnet | ✅ builds; 402 flow tested against the live x402.org facilitator; settlement needs funded devnet wallets (not tested) |
| | `spending`: budget + per-payment cap | ✅ builds; offline tests pass through the real x402 client |
| | `paidapi`: paid route + buyer page/script | ✅ builds; tested end to end up to settlement |
| | `paysh`: pay `paidapi` with the Pay.sh `pay` CLI, `pay claude`, and a catalog listing (`npm run paysh`) | ✅ builds; offline tests pass; `pay` 0.29.0 sends a valid x402 V2 devnet payment to `paidapi` (VERIFICATION PS1–PS4) |
| | `wallet`: visitors pay `paidapi` from their own Solana wallet (`@solana/react` + Wallet Standard) | ✅ builds, no secrets in the browser bundle; connect → sign → x402 → facilitator tested in a browser with a Wallet Standard test wallet (rejected for no funds, as expected); a real browser wallet settled a devnet payment (VERIFICATION W5) |
| Node.js service (Express 5, TS) | `base` | ✅ builds and starts (HTTP smoke test) |
| | `gemini`: `POST /api/chat` | ✅ builds; missing-key path tested; live call needs a key (not tested) |
| | `payments`: x402 V2 via `@x402/express`, Solana devnet | ✅ builds; 402 flow tested against the live x402.org facilitator; settlement needs funded devnet wallets (not tested) |
| | `spending`: budget + per-payment cap | ✅ builds; same offline tests as Next, pass through the real x402 client |
| | `paidapi`: `GET /premium-data` + `examples/client.ts` buyer | ✅ builds; tested end to end up to settlement |
| | `paysh`: pay `paidapi` with the Pay.sh `pay` CLI, `pay claude`, and a catalog listing (`npm run paysh`) | ✅ builds; offline tests pass; `pay` 0.29.0 sends a valid x402 V2 devnet payment to `paidapi` (VERIFICATION PS1–PS4) |
| Python autonomous agent (3.10+, FastAPI) | `base`: `python -m agent` CLI + FastAPI service | ✅ installs, typechecks (pyright), tests pass, starts (HTTP smoke test) |
| | `gemini`: `python -m agent ask`, `POST /api/chat` | ✅ missing-key path tested; live call needs a key (not tested) |
| | `payments`: x402 V2 via PyPI `x402` (FastAPI middleware + httpx client), Solana devnet | ✅ 402 flow tested against the live x402.org facilitator; settlement needs funded devnet wallets (not tested) |
| | `spending`: budget + per-payment cap + devnet-USDC only | ✅ same offline tests as Next/Node (plus USDG refused), pass through the real x402 client and httpx transport |
| | `paidapi`: `GET /premium-data` + `python -m agent buy` | ✅ tested end to end up to settlement |
| | `paysh`: pay `paidapi` with the Pay.sh `pay` CLI, `pay claude`, and a catalog listing (`python -m agent paysh`) | ✅ typechecks; offline tests pass; `pay` 0.29.0 sends a valid x402 V2 devnet payment to `paidapi` (VERIFICATION PS1–PS4) |
| Expo SDK 57 (expo-router, TS, Android) | `base` | ✅ installs, matches the SDK's expected versions, typechecks, bundles for Android (`expo export`); no device run (not tested) |
| | `gemini`: chat screen → companion `POST /api/chat` | ✅ app bundles with no secrets in it; companion builds + smoke test |
| | `payments`: app reads prices; companion charges/pays (x402 V2, Solana devnet) | ✅ same; companion is the node `payments` module |
| | `spending`: limits run in the companion, next to the key | ✅ companion's 8 offline tests pass |
| | `paidapi`: Premium screen → companion `GET /premium-data`, `POST /api/buy` | ✅ app bundles; companion smoke test |
| | `paysh`: pay `paidapi` with the Pay.sh `pay` CLI, `pay claude`, and a catalog listing (`companion-server: npm run paysh`) | ✅ companion is the node `paysh` module; offline tests pass; `pay` 0.29.0 sends a valid x402 V2 devnet payment to `paidapi` (VERIFICATION PS1–PS4) |
| | `wallet`: pay `paidapi` from a wallet app on the phone (Solana Mobile Wallet Adapter, `@solana/kit` signer + x402 in the app) | ✅ installs, typechecks, bundles; app source loads no keys; development build tested on the Android emulator with Solana Mobile's fakewallet: connect → sign → x402 → facilitator (rejected for no funds, as expected) (VERIFICATION E9–E11) |

[VERIFICATION.md](VERIFICATION.md) lists exactly what was tested and what wasn't. It also records the verified package versions.

## Layout

```
templates/<framework>/      nextjs (--framework next), node (--framework node), python (--framework python) or expo (--framework expo)
  base/                     the app (files at their final paths) + manifest.json + README.fragment.md
  modules/<id>/
    manifest.json           files, dependencies, scripts, env vars, prerequisites, requires
    files/…                 files copied into the app at the same relative path
    README.fragment.md      appended to the generated README
scripts/compose.mjs         composer (no dependencies) + catalog export
scripts/verify.mjs          composes a matrix of combinations, then install → typecheck → build → tests (→ HTTP smoke test for node and python; SDK version + no-secrets checks for expo, then the same node checks for its companion)
catalog.json                `npm run catalog` output: every manifest, for the Agent Studio UI
```

All frameworks have the same modules: `gemini`, `payments`, `spending` (requires `payments`), `paidapi` (requires `payments` and `spending`), `paysh` (requires `paidapi`). The logic is shared: `config.ts`, `client.ts`, the spending files, keygen/wallets and the tests are the Next versions with node-style imports (`../payments/config.js`) and without `import "server-only"`.

### The `node` template

- Express 5 + TypeScript, ESM. `npm run dev` runs `src/server.ts` with `tsx watch`; `npm run build` compiles `src/` to `dist/` with `tsc`; `npm start` runs `node dist/server.js`. `npm run typecheck` also covers `scripts/` and `examples/`.
- `src/server.ts` loads `.env.local` and then every file in `src/routes/`. Each module adds its endpoints by adding a route file (`export default function register(app)`), so modules still only add files.
- `GET /` returns the generated `src/modules.ts` list (the node equivalent of the Next home page).
- Payments: `paidRoute("GET /premium-data", () => ({ price, description }))` in `src/lib/payments/server.ts` wraps `@x402/express`'s `paymentMiddleware` and builds it on the first request, so the server starts without env vars and without calling the facilitator.

### The `python` template ("Autonomous Agent")

- Python ≥ 3.10, plain `venv` + `pip`. Dependencies are generated into `requirements.txt` (exact `==` pins of the direct dependencies); `requirements-dev.txt` adds `pyright[nodejs]` (bundles its own Node, so students need no npm). `pyproject.toml` only holds pyright settings. Secrets come from `.env` (python-dotenv; already-set environment variables win).
- One package, `agent/`. `python -m agent` is the command line; every file in `agent/commands/` adds commands (`register(commands)`). `python -m agent serve` runs the FastAPI app in `agent/server.py` with uvicorn on `PORT` (default 3000) and `HOST` (default `127.0.0.1`); every file in `agent/routes/` adds endpoints (`register(app)`). So modules still only add files.
- `GET /` returns the generated `agent/modules.py` list. Tests are stdlib `unittest` in `tests/` (no pytest): `python -m unittest discover -s tests -v`.
- Commands per module: `ask` (gemini), `keygen` / `keygen --pay-to` / `wallets` (payments), `buy [url] [-n N]` (paidapi), `paysh [url] [--sandbox] [--wallet] [--listing TEAM]` (paysh).
- Payments: `@paid_route(app, "GET", "/premium-data", lambda: PaidRouteOptions(price=…, description=…))` in `agent/payments/server.py` registers the FastAPI route *and* its x402 price in one call (so they can't drift apart, unlike node's string), and builds the x402 FastAPI middleware on the first paid request. It runs the facilitator's `/supported` call in a thread and returns 502 (retried next request) if it fails, instead of x402's default of blocking the event loop and exiting the process on a fatal init error.
- The x402 Python SDK names differ from TypeScript: `x402Client.on_before_payment_creation`, `set_spend_controls({"max_amount_per_payment": "$0.10"})`, `x402HttpxClient`, `payment_middleware` (FastAPI), `KeypairSigner` (solders). See VERIFICATION.md.

### The `expo` template and its companion server

- Expo SDK 57 + expo-router + TypeScript, Android first (`npm start` → Expo Go, `npm run android`). `npm run build` is `expo export --platform android`: it bundles the JavaScript (Hermes bytecode) without an Android SDK. It is a compile check, not an APK; students use EAS Build for that.
- **No secret ever ships in the app.** Anything in an app bundle, including `EXPO_PUBLIC_*` values, can be extracted. So `gemini`, `payments`, `spending` and `paidapi` don't call Gemini or sign payments in the app. They call a **companion server** over HTTP, and the companion holds `GEMINI_API_KEY` and `AGENT_PRIVATE_KEY`.
- **The companion is the verified node template, not new server code.** An expo module lists the node modules it needs in `companionModules` (gemini → `["gemini"]`, paidapi → `["paidapi"]`, …). If any are selected, `compose()` calls itself for `--framework node` with their union, writing into `companion-server/` (the base manifest's `companion.dir`). The result is a complete node project with its own `package.json`, `.env.example`, `README.md` and `studio.manifest.json`, byte-identical to `--framework node --modules <same>`.
- The expo base manifest's `companion` block adds `companion:install` / `companion` scripts, the `EXPO_PUBLIC_COMPANION_URL` setting (non-secret, optional) and a README section to the **app**, but only when a companion is generated. A base-only expo app has no companion and no companion settings.
- The app's `studio.manifest.json` lists the companion's files under `companion-server/…` and has `companion: { dir, framework, modules, env }`. The app's own `env` holds only `EXPO_PUBLIC_COMPANION_URL`; every secret is in `companion.env`.
- `lib/companion.ts` finds the companion: `EXPO_PUBLIC_COMPANION_URL` if set, otherwise port 3000 on the dev machine Expo already knows (`expoConfig.hostUri`, so Expo Go on a phone on the same Wi-Fi works), otherwise `10.0.2.2:3000` (Android emulator).
- `metro.config.js` blocks `companion-server/` from the bundle, so app code can't import server code by accident (tested: the build fails). `tsconfig.json` excludes it too.
- Spending limits run in the companion, next to the key they protect. Limits enforced inside an app could be patched out by whoever installs it.

## Using the composer

```bash
node scripts/compose.mjs --framework next --modules gemini,paidapi --out out/my-app
# -> "Also added required modules: payments, spending"
cd out/my-app && npm install && npm run build

node scripts/compose.mjs --framework node --modules paidapi --out out/my-service
cd out/my-service && npm install && npm run build && npm start

node scripts/compose.mjs --framework python --modules gemini,paidapi --out out/my-agent
cd out/my-agent && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python -m agent serve
node scripts/compose.mjs --framework expo --modules gemini,paidapi --out out/my-mobile-app
# -> app in out/my-mobile-app, companion (node: gemini, payments, spending, paidapi) in out/my-mobile-app/companion-server
cd out/my-mobile-app && npm install && npm run companion:install && npm run typecheck && npm run build
```

```bash
npm run catalog    # regenerates catalog.json (listTemplates)
npm run verify     # whole matrix (next + node + python + expo)
npm run verify -- node          # one framework
npm run verify -- full          # one combination, every framework
PYTHON=python3.12 npm run verify -- python   # python needs $PYTHON ≥ 3.10 (default python3)
npm run verify -- node-full     # one combination, one framework
```

CI (`.github/workflows/verify.yml`) runs the same matrix on every push, every PR, and every Monday. Python combinations run on Python 3.12. It also tests `full` on Node 20 for next, node and expo, `full` on Python 3.10 for python, checks `catalog.json` is up to date, and checks that the x402.org facilitator still supports Solana devnet.

Composition rules:

- Modules only **add** files. If two layers provide the same path, composition fails. Expo modules may not add files under `companion-server/`; that folder is always generated from the node template.
- Generated files: `package.json` (dependency/script union; a version clash fails), `.env.example` (one section per module, marking which vars are required or secret), `README.md` (base fragment + module fragments), the module list named by the base manifest's `modulesFile` (`lib/modules.ts` for next and expo, `src/modules.ts` for node, `agent/modules.py` for python; drives the home page / home screen / `GET /`), `studio.manifest.json` (what was generated).
- Per-framework base manifest fields: `modulesFile` (above); `modulesPlaceholder` (the line whose `[]` is replaced by the module list; default `export const modules: StudioModule[] = [];`); `dependencyFiles` (`{ "dependencies": "requirements.txt", "devDependencies": "requirements-dev.txt" }`: write pip requirement files with `name==version` lines instead of `package.json`; the dev file starts with `-r requirements.txt`). Without them the output for next and node is byte-identical to v0.2.0 apart from `scaffoldVersion` (checked for all 32 module subsets). For python, `scripts` are not written to any file: they document the commands and are listed in `studio.manifest.json`.
- `requires` is resolved automatically and in dependency order. Auto-added modules are listed in `studio.manifest.json.autoAddedModules`.
- `.env.local` (python: `.env`) is never generated, neither in the app nor in an expo `companion-server/`. Secrets are only ever typed by the student.
- Companion modules (`companionModules`) are composed as a nested node project; see *The `expo` template* above.

### Mapping to `ScaffoldGenerator` in superteam-agent-studio

| Generator method | Here |
| --- | --- |
| `listTemplates()` | `catalog()` export / `catalog.json` |
| `validateSelection()` | `resolveModules()`: unknown ids, cycles, missing `requires` (auto-added); `compose()` also fails on file or version conflicts |
| `generateProject()` | `compose()` into a temp dir, then zip it. The manifest is `studio.manifest.json` |

## Safety rules baked into the templates

- **Devnet only.** `lib/payments/config.ts` (`src/lib/payments/config.ts` in node, `agent/payments/config.py` in python) refuses every network except `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`. Going to mainnet takes a code change, not an env change.
- **Secrets stay server-side.** In Next, every file that reads `GEMINI_API_KEY` or `AGENT_PRIVATE_KEY` starts with `import "server-only"`, so importing it from a client component fails the build (tested). No secret uses a `NEXT_PUBLIC_` name. The node service and the python agent have no browser code; keys are read from env only and never returned in responses. The Expo app holds no secret at all: they live in `companion-server/.env.local`, and verify scans the exported Android bundle for `GEMINI_API_KEY`, `AGENT_PRIVATE_KEY`, `@google/genai` and signer code.
- **Bounded agent spending.** The buyer always runs with x402's built-in per-payment cap *and* the `spending` tracker (total budget, devnet-USDC only). `/api/buy` can only buy from the app's own `/api/premium` (node and python: `/premium-data` on `127.0.0.1` and the port the server is listening on), never a URL taken from the request. x402's own spend controls allow every default devnet stablecoin (USDC, USDG, PYUSD); the spending hook narrows that to devnet USDC.
- **Builds without env.** Paid routes are wired lazily, so `next build` / `tsc` and starting the node server or python agent need no keys and make no network calls. `expo export` needs no running companion and no `.env.local`.
