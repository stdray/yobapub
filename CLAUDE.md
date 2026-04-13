# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KinoPub client for Samsung Tizen TVs (2.3 / 3.0). SPA without frameworks — jQuery for DOM/AJAX, doT.js (`dot` npm package) for templating, custom router for page navigation. Russian language UI. API docs: https://kinoapi.com/

## Build Commands

All commands run from `src/front/`:

```bash
npm run dev          # webpack-dev-server on 0.0.0.0:8080
npm run build:dev    # development build
npm run build:release # production build (minified)
npm run typecheck    # TypeScript check (tsc --noEmit)
npm run csslint      # check CSS for unsupported features (doiuse vs Chrome >= 28)
npm run escheck      # verify built JS is ES5-compatible (es-check on dist/release)
npm run release      # typecheck + csslint + build:release + escheck
```

Backend (.NET proxy) is in `src/back/YobaPub.Proxy/`. No frontend tests exist.

## Build Target

Runtime target is Chromium 28 (Tizen 2.3), ES5 only. SWC transpiles all source code (including node_modules) to strict ES5 automatically — modern TypeScript syntax is fine. `core-js@3` polyfills (`Promise`, `Object.assign`, etc.) are injected by SWC via `mode: 'usage'`.

### CSS Tooling

`postcss-preset-env` (stage 2) is configured in `postcss.config.js` with `browserslist: Chrome >= 28`. It provides autoprefixer and CSS nesting (`& .child {}` syntax). It does **not** polyfill `gap` in flexbox.

### CSS Restrictions

Chromium 28 lacks many modern CSS features. **Do not use:**

- **`gap` in flexbox** — supported only from Chrome 84. **Not polyfilled by postcss-preset-env.** Use `margin` on children instead (e.g. negative margin on container + positive margin on items, or the owl selector `> * + *`).
- **CSS Grid (`display: grid`)** — supported only from Chrome 57. Use flexbox with wrapping.
- **CSS custom properties (`var(--*)`)** — supported only from Chrome 49. Hardcode values or use preprocessor variables.
- **`position: sticky`** — supported only from Chrome 56. Use fixed or absolute positioning.
- **`object-fit`** — polyfilled via `object-fit-images` (already included), but only for `<img>` tags.
- **`:is()`, `:where()`, `:has()` selectors** — not available. Use explicit selectors.
- **`aspect-ratio`** — not available. Use the padding-bottom percentage hack.

**Safe to use** (transpiled by postcss-preset-env):
- CSS nesting (`& .child {}`) — flattened to plain selectors.
- Autoprefixed properties (`-webkit-` added automatically).

### CSS Lint (`npm run csslint`)

`doiuse` checks `css/app.css` against `Chrome >= 28` on every `npm run release`. The following doiuse feature IDs are ignored because they are safe in this project:

- `css-overflow` — `overflow: hidden/auto/scroll` works fine; doiuse flags partial support for `overflow` shorthand with two values, which we don't use.
- `object-fit` — polyfilled for `<img>` via `object-fit-images`; `<video>` uses native Tizen rendering.
- `css-letter-spacing` — partial support means trailing space accounting; our decorative usage is unaffected.
- `word-break` — partial support is about `break-word` value; we only use `break-all` which works.
- `css-nesting` — postcss-preset-env flattens nesting before build; doiuse sees source CSS.

When adding a new ignore, document the reason here.

When in doubt, check https://caniuse.com against Chrome 28.

## Architecture

### Router (`ts/router.ts`)
- `Router` class with typed navigation methods: `navigateWatching()`, `navigateItem(item)`, `navigateMovie(id)`, `navigateSerial(id)`, etc.
- `registerPage(name, page)` — registers a page by name
- `navigate(route, params?)` — unmounts current, pushes to history, mounts new
- `goBack()` — pops history, remounts previous page
- `setParams(params)` — updates current route params (for focus restoration on back)
- `onAfterNavigate(cb)` — registers callback fired after every navigation
- Each page is a `<div id="page-{name}" class="page hidden">` in `index.html`
- Current routes (12): `login`, `watching`, `bookmarks`, `movie`, `serial`, `player`, `settings`, `novelties`, `search`, `tv`, `tv-player`, `history`

### Page Interface (`types/app.ts`)
Every page exports `{ mount(params), unmount() }`. On mount: render DOM, bind keys. On unmount: unbind keys, clear DOM, reset state.

### Sidebar (`ts/sidebar.ts`, `pages/sidebar-page.ts`)
- `SidebarPage` — abstract base class for pages with a side menu (novelties, watching, history, bookmarks, tv)
- `sidebar.ts` — renders the sidebar menu (items: Novelties, Watching, History, Bookmarks, TV, Search, Settings, Exit)
- `sidebar.wrapKeys(handler)` — wraps a page key handler to intercept Left arrow for sidebar focus

### Adding a New Page
1. Add route name to `RouteName` union in `types/app.ts`
2. Add any new params to `RouteParams` interface
3. Create `pages/{name}.ts` implementing `Page` (or extending `SidebarPage` if it needs the sidebar)
4. Add `<div id="page-{name}" class="page hidden">` to `index.html`
5. Import and `registerPage()` in `main.ts`

### TV Remote Navigation
- `pageKeys()` from `utils/page.ts` — binds/unbinds `$(window).on('keydown')`
- `TvKey` enum in `utils/platform.ts` — key codes (Enter, Return, Backspace, Escape, arrows, Stop, etc.)
- `gridMove(index, total, direction)` from `utils/grid.ts` — returns next index or -1 for card grids
- `CARDS_PER_ROW = 4` from `settings.ts`

### API Layer
- `ApiClient` class in `api/client.ts` with `apiGetWithRefresh(path, params?)` / `apiPostWithRefresh(path, data)`
- Auto-refreshes OAuth token on 401
- All API requests use relative URLs — they always go through the .NET proxy (`src/back/YobaPub.Proxy/`)
- Media content URLs (posters, video) are optionally rewritten via `proxyUrl(url)` from `utils/storage.ts`, gated by `isProxyAll()`
- API modules: `auth.ts` (OAuth), `watching.ts`, `items.ts`, `bookmarks.ts`, `device.ts`, `history.ts`, `tv.ts`

### Player (`pages/player.ts`, `pages/player/`)
The player page is split into submodules:
- `player.ts` — main page: HLS/HTTP playback via `<video>` + hls.js, seek, episode switching
- `player/hls.ts` — HLS URL rewriting for proxy
- `player/info.ts` — OSD info overlay (track names, quality, buffer state)
- `player/media.ts` — media source resolution (files, audio tracks, subtitles)
- `player/panel.ts` — settings panel (audio/subs/quality selection)
- `player/preferences.ts` — per-title playback preferences (quality, audio, subs)
- `player/progress.ts` — progress bar rendering and seek preview
- `player/subtitles.ts` — subtitle rendering and styling
- `player/template.ts` — doT template for the player UI

### Templates
- `doT.template(string)` returns a compiled render function (`dot` npm package, bundled by webpack)
- Templates are string concatenations in TypeScript, not separate files
- Reusable templates in `utils/templates.ts`: `tplCard`, `tplRating`, `tplEmptyText`, `renderRatings`, `renderPersonnel`

### External Libs (loaded as vendor scripts via webpack `externals` + `CopyWebpackPlugin`)
- `vendor/jquery.min.js` (jQuery 2.x) — imported as `from 'jquery'`, resolved to global `jQuery`
- `vendor/hls.min.js` (hls.js 0.14.x) — imported as `from 'hls.js'`, resolved to global `Hls`

### Utilities (`ts/utils/`)
- `page.ts` — `PageKeys` (binds/unbinds keydown), `PageUtils` (show/hide pages, scroll helpers)
- `platform.ts` — `TvKey` enum (key codes), `platform` singleton (Tizen API registration)
- `grid.ts` — `gridMove(index, total, direction)` for card grid navigation
- `storage.ts` — localStorage wrapper: tokens, settings, per-title preferences, proxy config
- `templates.ts` — shared doT templates (`tplCard`, `tplRating`, `tplEmptyText`, `renderRatings`, `renderPersonnel`)
- `format.ts` — `formatDuration`, `formatTimecode`, `formatTimeShort`, `formatAppVersion`
- `detail-controls.ts` — `DetailControls` class for movie/serial detail page button navigation
- `exit-dialog.ts` — exit confirmation dialog
- `hls-proxy.ts` — `buildBaseHlsConfig()`, `logPlaybackStart()`
- `hls-error.ts` — `showHlsError()` for HLS playback error display
- `log.ts` — `Logger` class for structured logging
- `number-set.ts` — lightweight numeric set utility
- `playback-errors.ts` — playback error tracking and reporting

## Code Style

- **No magic numbers** — avoid bare numeric literals for domain constants (quality IDs, key codes, etc.). Use `const enum`, named constants, or `readonly` static fields instead.
- **No `any`** — all variables, parameters, and return types must be explicitly typed. Use `unknown` + type guards if the shape is truly unknown.
- **Immutability everywhere** — always prefer immutable approaches: `const` for all declarations, `readonly` on interface/class properties, never mutate function arguments or existing arrays/objects. Create new collections (via `map`/`filter`/spread/LINQ) instead of mutating in-place with `for` loops. This applies to both TypeScript and C# code.
- **Arrow functions preferred** — use `const f = () => {}` syntax whenever possible. Arrow functions are more concise and modern. Avoid `function foo() {}` declarations except for class methods. Example: prefer `export const tpl = (data: Data) => compiled(data)` over `export function tpl(data: Data) { return compiled(data); }`.
- **Modern TypeScript syntax** — use `const`/`let` instead of `var`, template literals, destructuring, etc. SWC handles ES5 transpilation, so all modern syntax is fine.
- **Classes over factory functions** — prefer `class Foo { ... }` over `function makeFoo()` / object literals when defining reusable stateful objects.

## Commit Messages

- **Language**: English only, even though the UI and discussions are in Russian.
- **Format**: single-line subject, imperative mood, capitalized first word, no trailing period. No Conventional Commits prefixes (`feat:`, `fix:`, etc.) — this repo doesn't use them.
- **Length**: aim for ≤72 characters. Omit a body unless the *why* is non-obvious from the diff.
- **Content**: describe the change and, when useful, the mechanism or reason in the same line (e.g. `Reload HLS stream on seek with playSource instead of stopLoad/startLoad`, `Restart HLS buffer on seek to avoid bufferStalledError`).
- **Verbs**: `Add`, `Remove`, `Refactor`, `Fix`, `Reload`, `Restart`, etc. — action first, then object, then optional qualifier.
- **No attribution trailers** (no `Co-Authored-By`, no `Generated with …`) unless the user explicitly asks for them.

## Decision Log

Maintain `doc/decision-log.md` for any non-trivial technical decisions: rollbacks, investigation direction changes, experiments, confirmed/disproved hypotheses. Newest entry on top; format is defined at the top of the file. Record: timestamp, decision, reason, related data (logs, commits, diffs), outcome (or "awaiting verification"). This is mandatory — the log prevents going in circles during long investigations and remembers which paths have already been explored.

## Debugging Hard Bugs

When a bug is hard to reproduce, behavior is unclear, or several hypotheses miss in a row — **do not guess, collect data**. Default to:

- **Add more logging** — at key points, with context (variable values, flags, readyState, buffered ranges, etc.) so the situation can be reconstructed from a single dump without re-running.
- **Diagnostic patch** — temporary code that exposes internal behavior (e.g. wrap `videoEl.currentTime` via `Object.defineProperty` and log every assignment with a stack trace to find who actually seeks). Mark such patches as diagnostic in the code and remove after investigation.
- **Instrument library sources** in `node_modules` — if a black box's behavior is unclear from outside, add `console.log`/`logger` directly into hls.js/jQuery/etc. This is acceptable and often faster than reading code by eye.
- **Test in a regular browser** with DevTools — if the bug is not Tizen/TV-specific, reproduce on desktop where you have a proper debugger, network inspector, profiler, and breakpoints.

Rule: **never guess twice in a row**. If a hypothesis does not match the data, do not propose the next one from the same place — collect more data first. Guessing from indirect evidence without facts burns trust and leads down false paths (see `doc/decision-log.md` — the healing seek story where three iterations of hypotheses built on each other without verifying the root cause).

## Backend Proxy

`src/back/YobaPub.Proxy/` — .NET reverse proxy with HLS manifest rewriting (`HlsRewriter.cs`). Rewrites m3u8 URLs for audio track selection. Config in `appsettings.json`.
