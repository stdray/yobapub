# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

KinoPub client for Samsung Tizen TVs (2.3 / 3.0). SPA without frameworks — jQuery for DOM/AJAX, doT.js for templating, custom router for page navigation. Russian language UI. API docs: https://kinoapi.com/

## Build Commands

All commands run from `src/front/`:

```bash
npm run dev          # webpack-dev-server on 0.0.0.0:8080
npm run build:dev    # development build
npm run build:release # production build (minified)
npm run typecheck    # TypeScript check (tsc --noEmit)
npm run release      # typecheck + production build
```

Backend (.NET proxy) is in `src/back/YobaPub.Proxy/`. No frontend tests exist.

## Build Target

Runtime target is Chromium 28 (Tizen 2.3), ES5 only. SWC transpiles all source code (including node_modules) to strict ES5 automatically — modern TypeScript syntax is fine. `core-js@3` polyfills (`Promise`, `Object.assign`, etc.) are injected by SWC via `mode: 'usage'`.

## Architecture

### Router (`ts/router.ts`)
- `registerPage(name, page)` — registers a page by name
- `navigate(route, params?)` — unmounts current, pushes to history, mounts new
- `goBack()` — pops history, remounts previous page
- `setParams(params)` — updates current route params (for focus restoration on back)
- Each page is a `<div id="page-{name}" class="page hidden">` in `index.html`

### Page Interface (`types/app.ts`)
Every page exports `{ mount(params), unmount() }`. On mount: render DOM, bind keys. On unmount: unbind keys, clear DOM, reset state.

### Adding a New Page
1. Add route name to `RouteName` union in `types/app.ts`
2. Add any new params to `RouteParams` interface
3. Create `pages/{name}.ts` implementing `Page`
4. Add `<div id="page-{name}" class="page hidden">` to `index.html`
5. Import and `registerPage()` in `main.ts`

### TV Remote Navigation
- `pageKeys()` from `utils/page.ts` — binds/unbinds `$(window).on('keydown')`
- `TvKey` enum in `utils/platform.ts` — key codes (Enter, Return, Backspace, Escape, arrows, Stop, etc.)
- `gridMove(index, total, direction)` from `utils/grid.ts` — returns next index or -1 for card grids
- `CARDS_PER_ROW = 4` from `settings.ts`

### API Layer
- `apiGetWithRefresh(path, params?)` / `apiPostWithRefresh(path, data)` in `api/client.ts`
- Auto-refreshes OAuth token on 401
- All API requests use relative URLs — they always go through the .NET proxy (`src/back/YobaPub.Proxy/`)
- Media content URLs (posters, video) are optionally rewritten via `proxyUrl(url)` from `utils/storage.ts`, gated by `isProxyAll()`

### Templates
- `doT.template(string)` returns a compiled render function
- Templates are string concatenations in TypeScript, not separate files
- Reusable templates in `utils/templates.ts`: `tplCard`, `tplRating`, `tplEmptyText`

### External Libs (loaded as vendor scripts, not bundled)
- `vendor/jquery.min.js` (jQuery 2.x)
- `vendor/hls.min.js` (hls.js 0.14.x) — accessed via `window.Hls`

## Code Style

- **No `any`** — all variables, parameters, and return types must be explicitly typed. Use `unknown` + type guards if the shape is truly unknown.
- **Immutability** — prefer `const` for all declarations that are never reassigned. Use `readonly` on interface properties that are not meant to be mutated. Never mutate function arguments.
- **Arrow functions preferred** — use `const f = () => {}` syntax whenever possible. Arrow functions are more concise and modern. Avoid `function foo() {}` declarations except for class methods. Example: prefer `export const tpl = (data: Data) => compiled(data)` over `export function tpl(data: Data) { return compiled(data); }`.
- **Modern TypeScript syntax** — use `const`/`let` instead of `var`, template literals, destructuring, etc. SWC handles ES5 transpilation, so all modern syntax is fine.
- **Classes over factory functions** — prefer `class Foo { ... }` over `function makeFoo()` / object literals when defining reusable stateful objects.

## Backend Proxy

`src/back/YobaPub.Proxy/` — .NET reverse proxy with HLS manifest rewriting (`HlsRewriter.cs`). Rewrites m3u8 URLs for audio track selection. Config in `appsettings.json`.

