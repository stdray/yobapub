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

Веди `doc/decision-log.md` при любых нетривиальных технических решениях: откаты, изменение направления расследования, эксперименты, подтверждённые/опровергнутые гипотезы. Новая запись сверху, формат в начале файла. Фиксируй: время, решение, причину, связанные данные (логи, коммиты, диффы), результат (или "ждём проверки"). Это обязательно — журнал нужен чтобы не ходить по кругу в длинных расследованиях и помнить какие пути уже пройдены.

## Отладка сложных багов

Когда баг плохо воспроизводится, поведение неочевидно, или несколько гипотез подряд не попадают — **не гадай, собирай данные**. По умолчанию всегда предпочитай:

- **Добавить больше логов** — в ключевых точках, с контекстом (значения переменных, флаги, readyState, buffered и т.п.), чтобы восстановить происходящее по одному дампу без запуска.
- **Диагностический патч** — временный код, который вскрывает внутреннее поведение (например, обернуть `videoEl.currentTime` через `Object.defineProperty` и логировать каждое присваивание со стектрейсом, чтобы узнать кто реально seek'ает). Помечай такие патчи в коде как diagnostic и удаляй после выяснения причины.
- **Утыкать логами исходники библиотек** в `node_modules` — если поведение чёрного ящика непонятно снаружи, добавь `console.log`/`logger` прямо в hls.js/jQuery/др. Это допустимо и часто быстрее, чем читать код глазами.
- **Проверить поведение в обычном браузере** с DevTools — если баг не специфичен для Tizen/ТВ, воспроизведи на десктопе, где есть нормальный дебаггер, сетевой инспектор, профайлер и возможность ставить breakpoint'ы.

Правило: **никогда не гадай два раза подряд**. Если гипотеза не сошлась с данными — не предлагай следующую из того же места, сначала собери больше данных. Гадание по косвенным признакам без фактов сжигает доверие и уводит по ложным веткам (см. `doc/decision-log.md` — историю с healing seek, где три итерации гипотез строились друг на друге без проверки первичной причины).

## Backend Proxy

`src/back/YobaPub.Proxy/` — .NET reverse proxy with HLS manifest rewriting (`HlsRewriter.cs`). Rewrites m3u8 URLs for audio track selection. Config in `appsettings.json`.
