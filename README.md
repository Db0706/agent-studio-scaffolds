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
| Expo, Python | n/a | not started |

[VERIFICATION.md](VERIFICATION.md) lists exactly what was tested and what wasn't. It also records the verified package versions.

## Layout

```
templates/<framework>/      nextjs (--framework next) or node (--framework node)
  base/                     the app (files at their final paths) + manifest.json + README.fragment.md
  modules/<id>/
    manifest.json           files, dependencies, scripts, env vars, prerequisites, requires
    files/…                 files copied into the app at the same relative path
    README.fragment.md      appended to the generated README
scripts/compose.mjs         composer (no dependencies) + catalog export
scripts/verify.mjs          composes a matrix of combinations, then install → typecheck → build → tests (→ HTTP smoke test for node)
catalog.json                `npm run catalog` output: every manifest, for the Agent Studio UI
```

Both frameworks have the same modules: `gemini`, `payments`, `spending` (requires `payments`), `paidapi` (requires `payments` and `spending`). The logic is shared: `config.ts`, `client.ts`, the spending files, keygen/wallets and the tests are the Next versions with node-style imports (`../payments/config.js`) and without `import "server-only"`.

### The `node` template

- Express 5 + TypeScript, ESM. `npm run dev` runs `src/server.ts` with `tsx watch`; `npm run build` compiles `src/` to `dist/` with `tsc`; `npm start` runs `node dist/server.js`. `npm run typecheck` also covers `scripts/` and `examples/`.
- `src/server.ts` loads `.env.local` and then every file in `src/routes/`. Each module adds its endpoints by adding a route file (`export default function register(app)`), so modules still only add files.
- `GET /` returns the generated `src/modules.ts` list (the node equivalent of the Next home page).
- Payments: `paidRoute("GET /premium-data", () => ({ price, description }))` in `src/lib/payments/server.ts` wraps `@x402/express`'s `paymentMiddleware` and builds it on the first request, so the server starts without env vars and without calling the facilitator.

## Using the composer

```bash
node scripts/compose.mjs --framework next --modules gemini,paidapi --out out/my-app
# -> "Also added required modules: payments, spending"
cd out/my-app && npm install && npm run build

node scripts/compose.mjs --framework node --modules paidapi --out out/my-service
cd out/my-service && npm install && npm run build && npm start
```

```bash
npm run catalog    # regenerates catalog.json (listTemplates)
npm run verify     # whole matrix (next + node)
npm run verify -- node          # one framework
npm run verify -- full          # one combination, both frameworks
npm run verify -- node-full     # one combination, one framework
```

CI (`.github/workflows/verify.yml`) runs the same matrix on every push, every PR, and every Monday. It also tests `full` on Node 20 for both frameworks, checks `catalog.json` is up to date, and checks that the x402.org facilitator still supports Solana devnet.

Composition rules:

- Modules only **add** files. If two layers provide the same path, composition fails.
- Generated files: `package.json` (dependency/script union; a version clash fails), `.env.example` (one section per module, marking which vars are required or secret), `README.md` (base fragment + module fragments), the module list named by the base manifest's `modulesFile` (`lib/modules.ts` for next, `src/modules.ts` for node; drives the home page / `GET /`), `studio.manifest.json` (what was generated).
- `requires` is resolved automatically and in dependency order. Auto-added modules are listed in `studio.manifest.json.autoAddedModules`.
- `.env.local` is never generated. Secrets are only ever typed by the student.

### Mapping to `ScaffoldGenerator` in superteam-agent-studio

| Generator method | Here |
| --- | --- |
| `listTemplates()` | `catalog()` export / `catalog.json` |
| `validateSelection()` | `resolveModules()`: unknown ids, cycles, missing `requires` (auto-added); `compose()` also fails on file or version conflicts |
| `generateProject()` | `compose()` into a temp dir, then zip it. The manifest is `studio.manifest.json` |

## Safety rules baked into the templates

- **Devnet only.** `lib/payments/config.ts` (`src/lib/payments/config.ts` in node) refuses every network except `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`. Going to mainnet takes a code change, not an env change.
- **Secrets stay server-side.** In Next, every file that reads `GEMINI_API_KEY` or `AGENT_PRIVATE_KEY` starts with `import "server-only"`, so importing it from a client component fails the build (tested). No secret uses a `NEXT_PUBLIC_` name. The node service has no browser code; keys are read from env only and never returned in responses.
- **Bounded agent spending.** The buyer always runs with x402's built-in per-payment cap *and* the `spending` tracker (total budget, devnet-USDC only). `/api/buy` can only buy from the app's own `/api/premium` (node: `/premium-data` on `127.0.0.1` and the port the server is listening on), never a URL taken from the request.
- **Builds without env.** Paid routes are wired lazily, so `next build` / `tsc` and starting the node server need no keys and make no network calls.
