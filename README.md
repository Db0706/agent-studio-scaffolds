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
| Expo, Python, Node | n/a | not started |

[VERIFICATION.md](VERIFICATION.md) lists exactly what was tested and what wasn't. It also records the verified package versions.

## Layout

```
templates/nextjs/
  base/                     Next.js app (files at their final paths) + manifest.json + README.fragment.md
  modules/<id>/
    manifest.json           files, dependencies, scripts, env vars, prerequisites, requires
    files/…                 files copied into the app at the same relative path
    README.fragment.md      appended to the generated README
scripts/compose.mjs         composer (no dependencies) + catalog export
scripts/verify.mjs          composes a matrix of combinations, then install → typecheck → build → tests
catalog.json                `npm run catalog` output: every manifest, for the Agent Studio UI
```

Modules: `gemini`, `payments`, `spending` (requires `payments`), `paidapi` (requires `payments` and `spending`).

## Using the composer

```bash
node scripts/compose.mjs --framework next --modules gemini,paidapi --out out/my-app
# -> "Also added required modules: payments, spending"
cd out/my-app && npm install && npm run build
```

```bash
npm run catalog    # regenerates catalog.json (listTemplates)
npm run verify     # whole matrix; or: npm run verify -- full
```

Composition rules:

- Modules only **add** files. If two layers provide the same path, composition fails.
- Generated files: `package.json` (dependency/script union; a version clash fails), `.env.example` (one section per module, marking which vars are required or secret), `README.md` (base fragment + module fragments), `lib/modules.ts` (drives the home page), `studio.manifest.json` (what was generated).
- `requires` is resolved automatically and in dependency order. Auto-added modules are listed in `studio.manifest.json.autoAddedModules`.
- `.env.local` is never generated. Secrets are only ever typed by the student.

### Mapping to `ScaffoldGenerator` in superteam-agent-studio

| Generator method | Here |
| --- | --- |
| `listTemplates()` | `catalog()` export / `catalog.json` |
| `validateSelection()` | `resolveModules()`: unknown ids, cycles, missing `requires` (auto-added); `compose()` also fails on file or version conflicts |
| `generateProject()` | `compose()` into a temp dir, then zip it. The manifest is `studio.manifest.json` |

## Safety rules baked into the templates

- **Devnet only.** `lib/payments/config.ts` refuses every network except `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`. Going to mainnet takes a code change, not an env change.
- **Secrets stay server-side.** Every file that reads `GEMINI_API_KEY` or `AGENT_PRIVATE_KEY` starts with `import "server-only"`, so importing it from a client component fails the build (tested). No secret uses a `NEXT_PUBLIC_` name.
- **Bounded agent spending.** The buyer always runs with x402's built-in per-payment cap *and* the `spending` tracker (total budget, devnet-USDC only). `/api/buy` can only buy from the app's own `/api/premium`, never a URL taken from the request.
- **Builds without env.** Paid routes are wired lazily, so `next build` needs no keys and makes no network calls.
