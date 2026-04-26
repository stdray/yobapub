# Project Instructions

## Project Overview

KinoPub client for Samsung Tizen TVs (2.3 / 3.0). SPA without frameworks — jQuery for DOM/AJAX, doT.js (`dot` npm package) for templating, custom router for page navigation. Russian language UI. API docs: https://kinoapi.com/

## Build Commands

All commands run from `src/front/`:

```bash
npm run dev          # webpack-dev-server on 0.0.0.0:8080
npm run build:dev    # development build
npm run build:release # production build (minified)
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm run csslint      # doiuse vs Chrome >= 28
npm run release      # typecheck + lint + csslint + build:release + escheck (ES5 verify)
```

Backend (.NET proxy): `src/back/YobaPub.Proxy/`. No frontend tests.

## Build Target

Chromium 28 (Tizen 2.3), ES5 only. SWC transpiles all source (including node_modules) to ES5. `core-js@3` polyfills injected via `mode: 'usage'`. Modern TypeScript syntax is fine.

### CSS

`postcss-preset-env` (stage 2, `Chrome >= 28`) provides autoprefixer and CSS nesting. **Does not** polyfill `gap` in flexbox.

**Forbidden** (not supported in Chrome 28): `gap` in flexbox, CSS Grid, CSS custom properties (`var(--*)`), `position: sticky`, `:is()`/`:where()`/`:has()`, `aspect-ratio`. `object-fit` polyfilled for `<img>` only.

**Safe** (transpiled by postcss): CSS nesting (`& .child {}`), autoprefixed `-webkit-` properties.

**csslint ignores** (doiuse false positives, document reason here when adding): `css-overflow` (two-value shorthand unused), `object-fit` (polyfilled for img), `css-letter-spacing` (decorative only), `word-break` (only `break-all`), `css-nesting` (flattened by postcss).

## Architecture

### Core patterns
- **Router** (`ts/router.ts`): `registerPage(name, page)`, `navigate(route, params?)`, `goBack()`, `setParams()`. Each page is `<div id="page-{name}" class="page hidden">` in `index.html`. 12 routes: `login`, `watching`, `bookmarks`, `movie`, `serial`, `player`, `settings`, `novelties`, `search`, `tv`, `tv-player`, `history`.
- **Page interface** (`types/app.ts`): `{ mount(params), unmount() }`. Mount: render DOM, bind keys. Unmount: unbind, clear, reset.
- **Sidebar** (`ts/sidebar.ts`, `pages/sidebar-page.ts`): `SidebarPage` base class for pages with side menu. `sidebar.wrapKeys(handler)` intercepts Left for sidebar focus.
- **FSM** (`utils/fsm.ts`): declarative finite-state machine — states, events, transitions with `entry`/`exit`/`after`/`cond`/`action`. Used by player (`player/player-fsm.ts`), movie, serial pages for focus navigation.
- **TV Remote**: `TvKey` enum + `keyToEventType()` in `utils/platform.ts`, `gridMove()` in `utils/grid.ts`, `PageKeys` in `utils/page.ts`.
- **API**: `ApiClient` in `api/client.ts` with auto OAuth token refresh. All requests go through .NET proxy. Modules: `auth`, `watching`, `items`, `bookmarks`, `device`, `history`, `tv`.
- **Templates**: `doT.template(string)` compiled in TypeScript. Shared templates in `utils/templates.ts`.
- **Vendor**: jQuery 2.x (`from 'jquery'` → global), hls.js 0.14.x (`from 'hls.js'` → global), loaded via webpack externals.

### Adding a new page
1. Add to `RouteName` union in `types/app.ts` (+params in `RouteParams`)
2. Create `pages/{name}.ts` implementing `Page` (or extending `SidebarPage`)
3. Add `<div id="page-{name}" class="page hidden">` to `index.html`
4. Import and `registerPage()` in `main.ts`

### Player (`pages/player.ts`, `pages/player/`)
16 submodules: `player-fsm.ts` (UI state machine), `hls-engine.ts` / `hls-adapter.ts` (HLS lifecycle), `media.ts` (source resolution), `panel.ts` (audio/subs/quality), `overlay.ts` (HUD), `seek.ts` + `progress.ts` (seeking), `subtitles.ts`, `preferences.ts`, `watch-tracker.ts`, `video-bindings.ts`, `track-navigator.ts`, `error-view.ts`, `template.ts`, `ct-debug.ts`.

### Key utilities (`ts/utils/`)
`page.ts` (PageKeys, PageUtils, showConfirmDialog), `platform.ts` (TvKey, keyToEventType, DetailKeyEvent), `fsm.ts`, `grid.ts`, `storage.ts` (localStorage wrapper), `templates.ts`, `detail-controls.ts` (bookmark/watchlist controls), `format.ts`, `hls-utils.ts`, `log.ts`, `array.ts`, `number-set.ts`, `lazy.ts`, `url.ts`.

## Code Style

- **No magic numbers** — use `const enum`, named constants, or `readonly` static fields.
- **No `any`** — use `unknown` + type guards.
- **No spread, no `for...of`** — lint enforces (`es-x/no-spread-elements`, `es-x/no-rest-spread-properties`, `es-x/no-for-of-loops`). Chromium 28 lacks `Symbol.iterator`. Use indexed loops or `Array.from()`; `Object.assign({}, x, y)` instead of `{ ...x, ...y }`.
- **Immutability** — `const`, `readonly`, never mutate arguments/existing objects. `.map()` / `.filter()` over push-in-a-loop. Applies to TS and C#.
- **Loops** — `.map().join('')` / `.filter().map()` to build values; `.forEach()` for side effects; indexed `for` only for `break`/`continue` or hot paths.
- **Compact form** — shorter syntax when equivalent: braceless single-statement `if`, ternary, implicit arrow return.
- **Arrow functions** — `const f = () => {}` for top-level/helpers/callbacks. Class methods: regular syntax; arrow-field only when passed as callback losing `this`.
- **Classes over factory functions** for stateful objects.

## Commit Messages

English, imperative, capitalized, no period, ≤72 chars. No Conventional Commits prefixes. No attribution trailers unless asked. Body only when *why* is non-obvious.

## Process

- **Decision log** (`doc/decision-log.md`): record non-trivial technical decisions, rollbacks, experiments. Newest on top. Prevents going in circles.
- **Debugging**: don't guess twice — if a hypothesis fails, collect data before the next one. Add logging with context, use diagnostic patches, instrument `node_modules` if needed, reproduce in a desktop browser when possible.
- **Logs from device** (`tmp/`): when the user provides a log URL (e.g. `https://yobapub.3po.su/s/logs/.../tsv`), ALWAYS download to `tmp/<id>.tsv` first (`curl -sL <url> -o tmp/<id>.tsv`), then analyze the file with `Read`/`Grep`. Don't rely on `WebFetch` — it summarizes and drops critical lines. `tmp/` is gitignored.

## Backend Proxy

`src/back/YobaPub.Proxy/` — .NET reverse proxy with HLS manifest rewriting (`HlsRewriter.cs`). Config in `appsettings.json`.
