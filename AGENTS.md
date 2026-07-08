# YobaPub — Development Doctrine

This document is the **canonical** source of dev practice for YobaPub. Any other pointer file (e.g. `CLAUDE.md`) defers to this one. Read this before touching the repo.

## What YobaPub is

KinoPub client for Samsung Tizen TVs (2.3 / 3.0) and Android TV. SPA without frameworks — jQuery for DOM/AJAX, doT.js for templating, custom router. Russian language UI. Backend: .NET reverse proxy with HLS manifest rewriting.

## Where the living truth lives

**The live plan, status, and tasks are NOT in this repo.** They live in the PetBox project `yobapub`:

- **work-v2** — task board (classic kind: Backlog → Todo → InProgress → InReview → Done)
- **Memory** (`memory_search`) — durable facts: decisions, gotchas, platform quirks, architecture notes
- **Sessions** (`session_search`) — past conversation history

Canon for how decisions map to work: every change starts from a card on the work board. Consult PetBox memory before re-investigating anything — most past decisions, bugs, and platform quirks are already recorded there.

## Process contract (binding for ALL agents)

1. **No code before a card.** Every change starts from a work item on the `work-v2` board. Create/move the card BEFORE editing code.
2. **Worktree before edits.** Never edit the primary checkout; create a git worktree for the change: `git worktree add <abs-path> -b <branch>`. `master` stays clean — only merged, verified branches land there.
3. **Search before rework.** Before re-deriving or re-investigating anything, run `petbox___memory_search` first. Redoing work the project already remembers is the failure mode this protocol exists to prevent.
4. **Delegate by default.** The orchestrator economizes context: implementation goes to **worker subagents**. The main session stays at the decision/review/coordination level, not writing code by hand. Every worker brief MUST open with the worker preamble: `You are a WORKER subagent, not an orchestrator — one scoped task. Do ONLY this brief, no scope expansion, no subagent spawning. Search before rework, stay in your worktree.`
5. **Finish = branch + commit + push.** Completed work is committed on a feature branch and pushed BEFORE the card moves to `InReview`. Never leave finished edits uncommitted.
6. **Agent ceiling is Review.** Mark finished work `InReview`, never `Done` — the maintainer confirms `Done`.
7. **Record decisions.** Non-trivial technical decisions → `petbox___memory_remember` (type: `Reference`). Update existing facts via `petbox___memory_upsert` — never duplicate.
8. **Don't silently work around process/doc defects.** File an intake issue or flag the gap explicitly.

## Build Commands

All frontend commands run from `src/front/`:

```bash
npm run dev          # webpack-dev-server on 0.0.0.0:8080
npm run build:dev    # development build
npm run build:release # production build (minified)
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm run csslint      # doiuse vs Chrome >= 28
npm run release      # typecheck + lint + csslint + build:release + escheck (ES5 verify)
```

Backend: `src/back/YobaPub.Proxy/` — `dotnet build` + `dotnet test` (16 tests). No frontend tests.

## Build Target

Chromium 28 (Tizen 2.3), ES5 only. SWC transpiles all source (including `node_modules`) to ES5. `core-js@3` polyfills via `mode: 'usage'`. Modern TypeScript syntax is fine.

### CSS constraints

`postcss-preset-env` (stage 2, `Chrome >= 28`) provides autoprefixer and CSS nesting flattening. **Does not** polyfill `gap` in flexbox.

**Forbidden** (Chrome 28): `gap` in flexbox, CSS Grid, `var(--*)`, `position: sticky`, `:is()`/`:where()`/`:has()`, `aspect-ratio`. `object-fit` polyfilled for `<img>` only.

**csslint ignores** (doiuse false positives): `css-overflow`, `object-fit`, `css-letter-spacing`, `word-break`, `css-nesting`.

## Architecture

### Core patterns
- **Router** (`ts/router.ts`): `registerPage(name, page)`, `navigate(route, params?)`, `goBack()`. 12 routes: `login`, `watching`, `bookmarks`, `movie`, `serial`, `player`, `settings`, `novelties`, `search`, `tv`, `tv-player`, `history`.
- **Page interface** (`types/app.ts`): `{ mount(params), unmount() }`. Mount: render DOM, bind keys. Unmount: unbind, clear, reset.
- **Sidebar** (`ts/sidebar.ts`): `SidebarPage` base class with side menu. `sidebar.wrapKeys(handler)` intercepts Left for sidebar focus.
- **FSM** (`utils/fsm.ts`): declarative finite-state machine used by player (`player/player-fsm.ts`), movie, serial pages for focus navigation.
- **TV Remote**: `TvKey` enum + `keyToEventType()` in `utils/platform.ts`, `gridMove()` in `utils/grid.ts`.
- **API**: `ApiClient` in `api/client.ts` with auto OAuth token refresh. All requests go through .NET proxy.
- **Templates**: `doT.template(string)` compiled in TypeScript. Shared in `utils/templates.ts`.
- **Vendor**: jQuery 2.x, hls.js 0.14.x — loaded via webpack externals.

### Player (`pages/player.ts`, `pages/player/`)
Uses `PlayState` + `continuePlaying()` as the single entry point for all state transitions. Key modules: `player-fsm.ts` (UI state machine), `hls-engine.ts` / `hls-adapter.ts` (legacy/modern HLS lifecycle), `media.ts` (source resolution), `panel.ts` (audio/subs/quality), `subtitles.ts`, `seek.ts` + `progress.ts`. Architecture documented in `doc/player-flow.md`.

### Adding a new page
1. Add to `RouteName` union in `types/app.ts` (+params in `RouteParams`)
2. Create `pages/{name}.ts` implementing `Page` (or extending `SidebarPage`)
3. Add `<div id="page-{name}" class="page hidden">` to `index.html`
4. Import and `registerPage()` in `main.ts`

## Code Style

- **No magic numbers** — `const enum`, named constants, or `readonly` static fields.
- **No `any`** — `unknown` + type guards.
- **No spread, no `for...of`** — Chromium 28 lacks `Symbol.iterator`. Use indexed loops or `Array.from()`; `Object.assign({}, x, y)` instead of `{ ...x, ...y }`.
- **Immutability** — `const`, `readonly`, never mutate arguments. `.map()`/`.filter()` over push-in-a-loop. Applies to TS and C#.
- **Loops** — `.map().join('')`/`.filter().map()` to build values; `.forEach()` for side effects; indexed `for` only for `break`/`continue`.
- **Compact form** — braceless single-statement `if`, ternary, implicit arrow return.
- **Arrow functions** — `const f = () => {}` for top-level/helpers. Class methods: regular syntax; arrow-field only when passed as callback losing `this`.

## Commit Messages

English, imperative, capitalized, no period, ≤72 chars. No Conventional Commits prefixes. Body only when *why* is non-obvious.

## Debugging & Logs

- **Don't guess twice** — if a hypothesis fails, collect data before the next one. Add logging with context, instrument `node_modules` if needed, reproduce in a desktop browser when possible.
- **Device logs**: client logs in PetBox log `clients`, proxy self-logs in `backend`. Query via `petbox___log_query` (KQL). For long excerpts, save to `tmp/` (gitignored) and analyze with `Read`/`Grep`.
- **Log levels**: default via PetBox config binding `client-log/level`. Per-device override: same path + tag `device:{id}`. TV fetches level at startup from `GET /api/log-config?deviceId=`, caches in `kp_log_level`. Level change applies on next app launch.

## Backend Proxy

`src/back/YobaPub.Proxy/` — .NET reverse proxy with HLS manifest rewriting. Smoke tests: `scripts/smoke.ps1 -BaseUrl <url>` (run after every deploy; `-PetBoxApiKey` = key `yobapub-smoke` for log delivery verification). PetBox integration: client logs → `clients` (CLEF batches), self-logs → `backend` (Seq.Extensions.Logging), VIP + log levels from PetBox config. `PetBox__ApiKey` from env; empty key = all PetBox integrations disabled (local dev).
