# Agent Studio scaffolds

Composable starter templates for **Superteam Agent Studio**'s Project Builder. Each template is a **base** app plus optional **modules**. A small composer (`scripts/compose.mjs`) merges them into a project a student can `npm install && npm run dev`.

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
| Node.js service (Express 5, TS) | `base` | ✅ builds and starts (HTTP smoke test) |
| | `gemini`: `POST /api/chat` | ✅ builds; missing-key path tested; live call needs a key (not tested) |
| | `payments`: x402 V2 via `@x402/express`, Solana devnet | ✅ builds; 402 flow tested against the live x402.org facilitator; settlement needs funded devnet wallets (not tested) |
| | `spending`: budget + per-payment cap | ✅ builds; same offline tests as Next, pass through the real x402 client |
| | `paidapi`: `GET /premium-data` + `examples/client.ts` buyer | ✅ builds; tested end to end up to settlement |
| Expo SDK 57 (expo-router, TS, Android) | `base` | ✅ installs, matches the SDK's expected versions, typechecks, bundles for Android (`expo export`); no device run (not tested) |
| | `gemini`: chat screen → companion `POST /api/chat` | ✅ app bundles with no secrets in it; companion builds + smoke test |
| | `payments`: app reads prices; companion charges/pays (x402 V2, Solana devnet) | ✅ same; companion is the node `payments` module |
| | `spending`: limits run in the companion, next to the key | ✅ companion's 8 offline tests pass |
| | `paidapi`: Premium screen → companion `GET /premium-data`, `POST /api/buy` | ✅ app bundles; companion smoke test |
| Python | n/a | in progress on another branch |

[VERIFICATION.md](VERIFICATION.md) lists exactly what was tested and what wasn't. It also records the verified package versions.

## Layout

```
templates/<framework>/      nextjs (--framework next), node (--framework node) or expo (--framework expo)
  base/                     the app (files at their final paths) + manifest.json + README.fragment.md
  modules/<id>/
    manifest.json           files, dependencies, scripts, env vars, prerequisites, requires
    files/…                 files copied into the app at the same relative path
    README.fragment.md      appended to the generated README
scripts/compose.mjs         composer (no dependencies) + catalog export
scripts/verify.mjs          composes a matrix of combinations, then install → typecheck → build → tests (→ HTTP smoke test for node; SDK version + no-secrets checks for expo, then the same node checks for its companion)
catalog.json                `npm run catalog` output: every manifest, for the Agent Studio UI
```

All three frameworks have the same modules: `gemini`, `payments`, `spending` (requires `payments`), `paidapi` (requires `payments` and `spending`). The logic is shared: `config.ts`, `client.ts`, the spending files, keygen/wallets and the tests are the Next versions with node-style imports (`../payments/config.js`) and without `import "server-only"`.

### The `node` template

- Express 5 + TypeScript, ESM. `npm run dev` runs `src/server.ts` with `tsx watch`; `npm run build` compiles `src/` to `dist/` with `tsc`; `npm start` runs `node dist/server.js`. `npm run typecheck` also covers `scripts/` and `examples/`.
- `src/server.ts` loads `.env.local` and then every file in `src/routes/`. Each module adds its endpoints by adding a route file (`export default function register(app)`), so modules still only add files.
- `GET /` returns the generated `src/modules.ts` list (the node equivalent of the Next home page).
- Payments: `paidRoute("GET /premium-data", () => ({ price, description }))` in `src/lib/payments/server.ts` wraps `@x402/express`'s `paymentMiddleware` and builds it on the first request, so the server starts without env vars and without calling the facilitator.

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

node scripts/compose.mjs --framework expo --modules gemini,paidapi --out out/my-mobile-app
# -> app in out/my-mobile-app, companion (node: gemini, payments, spending, paidapi) in out/my-mobile-app/companion-server
cd out/my-mobile-app && npm install && npm run companion:install && npm run typecheck && npm run build
```

```bash
npm run catalog    # regenerates catalog.json (listTemplates)
npm run verify     # whole matrix (next + node + expo)
npm run verify -- node          # one framework
npm run verify -- full          # one combination, both frameworks
npm run verify -- node-full     # one combination, one framework
```

CI (`.github/workflows/verify.yml`) runs the same matrix on every push, every PR, and every Monday. It also tests `full` on Node 20 for every framework, checks `catalog.json` is up to date, and checks that the x402.org facilitator still supports Solana devnet.

Composition rules:

- Modules only **add** files. If two layers provide the same path, composition fails. Expo modules may not add files under `companion-server/`; that folder is always generated from the node template.
- Generated files: `package.json` (dependency/script union; a version clash fails), `.env.example` (one section per module, marking which vars are required or secret), `README.md` (base fragment + module fragments), the module list named by the base manifest's `modulesFile` (`lib/modules.ts` for next and expo, `src/modules.ts` for node; drives the home page / home screen / `GET /`), `studio.manifest.json` (what was generated).
- `requires` is resolved automatically and in dependency order. Auto-added modules are listed in `studio.manifest.json.autoAddedModules`.
- `.env.local` is never generated (neither in the app nor in `companion-server/`). Secrets are only ever typed by the student.
- Companion modules (`companionModules`) are composed as a nested node project; see *The `expo` template* above.

### Mapping to `ScaffoldGenerator` in superteam-agent-studio

| Generator method | Here |
| --- | --- |
| `listTemplates()` | `catalog()` export / `catalog.json` |
| `validateSelection()` | `resolveModules()`: unknown ids, cycles, missing `requires` (auto-added); `compose()` also fails on file or version conflicts |
| `generateProject()` | `compose()` into a temp dir, then zip it. The manifest is `studio.manifest.json` |

## Safety rules baked into the templates

- **Devnet only.** `lib/payments/config.ts` (`src/lib/payments/config.ts` in node) refuses every network except `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`. Going to mainnet takes a code change, not an env change.
- **Secrets stay server-side.** In Next, every file that reads `GEMINI_API_KEY` or `AGENT_PRIVATE_KEY` starts with `import "server-only"`, so importing it from a client component fails the build (tested). No secret uses a `NEXT_PUBLIC_` name. The node service has no browser code; keys are read from env only and never returned in responses. The Expo app holds no secret at all: they live in `companion-server/.env.local`, and verify scans the exported Android bundle for `GEMINI_API_KEY`, `AGENT_PRIVATE_KEY`, `@google/genai` and signer code.
- **Bounded agent spending.** The buyer always runs with x402's built-in per-payment cap *and* the `spending` tracker (total budget, devnet-USDC only). `/api/buy` can only buy from the app's own `/api/premium` (node: `/premium-data` on `127.0.0.1` and the port the server is listening on), never a URL taken from the request.
- **Builds without env.** Paid routes are wired lazily, so `next build` / `tsc` and starting the node server need no keys and make no network calls. `expo export` needs no running companion and no `.env.local`.
