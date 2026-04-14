# KinoPub Tizen TV App

KinoPub client for Samsung Tizen TVs (2.3 / 3.0).

## API Documentation

- https://kinoapi.com/

## Architecture

Single-page application (SPA) without frameworks. Page navigation is implemented via a custom router that toggles visibility of DOM containers. All pages render inside `<div id="app">`.

```
src/
├── index.html                  # Entry point, vendor scripts, styles
├── css/
│   └── app.css                 # All styles (plain CSS + nesting via postcss-preset-env)
├── ts/
│   ├── main.ts                 # App init, page registration, router setup
│   ├── router.ts               # Router class: navigate, goBack, setParams, typed helpers
│   ├── sidebar.ts              # Sidebar menu (Novelties, Watching, History, Bookmarks, TV, Search, Settings, Exit)
│   ├── config.ts               # OAuth client ID / secret
│   ├── settings.ts             # App constants (CARDS_PER_ROW)
│   ├── api/
│   │   ├── client.ts           # ApiClient: GET/POST with auto token refresh on 401
│   │   ├── auth.ts             # OAuth Device Flow (device_code, device_token)
│   │   ├── watching.ts         # /v1/watching/* (movies, serials, marktime, toggle)
│   │   ├── items.ts            # /v1/items, /v1/items/<id>, /v1/items/search
│   │   ├── bookmarks.ts        # /v1/bookmarks/* (folders, toggle, create)
│   │   ├── device.ts           # /v1/device/info, /v1/device/unlink
│   │   ├── history.ts          # /v1/history
│   │   └── tv.ts               # /v1/tv (live channels)
│   ├── types/
│   │   ├── api.ts              # API response types (Item, Season, Episode, Video, Pagination, etc.)
│   │   ├── app.ts              # Internal types (RouteName, RouteParams, Page)
│   │   ├── dot.d.ts            # doT.js type declarations
│   │   ├── globals.d.ts        # Global declarations (__APP_VERSION__, __BUILD_SHA__, etc.)
│   │   └── object-fit-images.d.ts
│   ├── pages/
│   │   ├── sidebar-page.ts     # SidebarPage abstract base class for pages with sidebar
│   │   ├── login.ts            # Login screen (device code flow)
│   │   ├── watching.ts         # "Watching" screen (serials + movies)    [extends SidebarPage]
│   │   ├── novelties.ts        # "Novelties" screen (new releases)       [extends SidebarPage]
│   │   ├── history.ts          # Watch history                           [extends SidebarPage]
│   │   ├── bookmarks.ts        # Bookmark folders                        [extends SidebarPage]
│   │   ├── tv.ts               # Live TV channels                        [extends SidebarPage]
│   │   ├── search.ts           # Search screen
│   │   ├── movie.ts            # Movie detail (info + "Watch" button)
│   │   ├── serial.ts           # Serial detail (seasons → episodes)
│   │   ├── settings.ts         # App settings
│   │   ├── player.ts           # Video player (HLS/HTTP via <video> + hls.js)
│   │   ├── player/
│   │   │   ├── hls.ts          # HLS URL rewriting for proxy
│   │   │   ├── info.ts         # OSD info overlay
│   │   │   ├── media.ts        # Media source resolution (files, audio, subtitles)
│   │   │   ├── panel.ts        # Settings panel (audio/subs/quality selection)
│   │   │   ├── preferences.ts  # Per-title playback preferences
│   │   │   ├── progress.ts     # Progress bar and seek preview
│   │   │   ├── subtitles.ts    # Subtitle rendering and styling
│   │   │   └── template.ts     # doT template for player UI
│   │   └── tv-player.ts        # Live TV player
│   └── utils/
│       ├── page.ts             # PageKeys (keydown bind/unbind), PageUtils (show/hide, scroll)
│       ├── platform.ts         # TvKey enum, Tizen platform API, media key registration
│       ├── grid.ts             # gridMove() for card grid navigation
│       ├── storage.ts          # localStorage: tokens, settings, per-title prefs, proxy config
│       ├── templates.ts        # Shared doT templates: tplCard, tplRating, tplEmptyText, renderRatings, renderPersonnel
│       ├── format.ts           # formatDuration, formatTimecode, formatTimeShort, formatAppVersion
│       ├── detail-controls.ts  # DetailControls class for movie/serial detail button navigation
│       ├── exit-dialog.ts      # Exit confirmation dialog
│       ├── hls-utils.ts        # HLS config, proxy URL rewriting, error display
│       ├── log.ts              # Logger class for structured logging
│       └── number-set.ts       # Lightweight numeric set utility
```

### Data Flow

```
[TV Remote] → [Tizen Key Events] → [PageKeys handler] → [Page logic]
                                                              ↓
                                                        [API Client] → [.NET Proxy] → [api.service-kp.com]
                                                              ↓
                                                        [DOM Update (jQuery + doT templates)]
```

## Target Platforms

| Platform  | Web Engine   | ES Support |
|-----------|-------------|------------|
| Tizen 2.3 | Chromium ~28 | ES5 |
| Tizen 3.0 | Chromium ~47 | ES5 + partial ES6 |

**Important:** All code (including `node_modules`) is compiled to strict ES5 via SWC. No ES6+ constructs may appear at runtime — no arrow functions, no `const`/`let`, no destructuring, no template literals. Polyfills (`Promise`, `Object.assign`, `Array.from`, etc.) are provided via `core-js@3` with `mode: 'usage'` — SWC automatically injects only what is actually used.

## Libraries

| Library | Version | Purpose |
|---------|---------|---------|
| **jQuery** | 2.x | DOM manipulation, AJAX requests, old engine compatibility |
| **doT.js** (`dot`) | 1.x | Lightweight templating engine (compiled templates) |
| **hls.js** | 0.14.x | HLS streaming for browsers without native HLS support |
| **object-fit-images** | — | `object-fit` polyfill for `<img>` on Chromium 28 |
| **@swc/core** + **swc-loader** | 1.x | TS + ES6+ → strict ES5 transpilation in one pass (incl. node_modules) |
| **core-js** | 3.x | ES6+ polyfills, injected by SWC via `mode: 'usage'` |

> **Why hls.js over video.js:** Video.js is heavy (~500KB), has many dependencies, and has ES5 issues. hls.js is lightweight (~60KB), works directly with `<video>`, and is sufficient for KinoPub HLS streams. For HTTP streams (mp4) `<video>` is used directly.

jQuery and hls.js are loaded as vendor scripts (`<script>` in index.html) and declared as webpack `externals`. They are imported normally (`from 'jquery'`, `from 'hls.js'`) but resolved to globals (`jQuery`, `Hls`). `CopyWebpackPlugin` copies them from `node_modules` to `vendor/` at build time.

## Build

- **Webpack** — bundler (`target: ['web', 'es5']`)
- **SWC** (`swc-loader`) — single loader replacing both `ts-loader` and `babel-loader`
  - Compiles TypeScript and transpiles to strict ES5 in one pass
  - Processes **all code**, including `node_modules` (strips ES6+ from dependencies)
  - ~20–70x faster than Babel (written in Rust)
- **core-js@3** — polyfills via `mode: 'usage'`

```
.ts and .js (incl. node_modules) → swc-loader (TS + ES5) → webpack bundle → dist/app.js
```

> **Why SWC over Babel:** Single loader instead of two (`ts-loader` + `babel-loader`), minimal config, fast builds. Transpiles TypeScript, strips ES6+ syntax from dependencies, injects polyfills — all in one pass.

## Pages (Routes)

| Route | Page | Description |
|-------|------|-------------|
| `login` | `pages/login.ts` | Device code login (OAuth Device Flow) |
| `watching` | `pages/watching.ts` | "Watching" — unwatched movies + serials with new episodes |
| `novelties` | `pages/novelties.ts` | New releases by content type |
| `history` | `pages/history.ts` | Watch history |
| `bookmarks` | `pages/bookmarks.ts` | Bookmark folders and items |
| `tv` | `pages/tv.ts` | Live TV channel list |
| `search` | `pages/search.ts` | Search by title |
| `movie` | `pages/movie.ts` | Movie detail (info, ratings, "Watch" button) |
| `serial` | `pages/serial.ts` | Serial detail (seasons → episodes with progress) |
| `settings` | `pages/settings.ts` | App settings (quality, start page, device, proxy) |
| `player` | `pages/player.ts` | Video player (HLS/HTTP, seek, marktime, episode switching) |
| `tv-player` | `pages/tv-player.ts` | Live TV player |

## API Endpoints (Used)

Base URL: via .NET reverse proxy → `https://api.service-kp.com`

### Authentication (OAuth Device Flow)

| Method | Endpoint | Purpose |
|--------|---------|---------|
| POST | `/oauth2/device` (`grant_type=device_code`) | Get `user_code` for display on screen |
| POST | `/oauth2/device` (`grant_type=device_token`) | Poll: wait for user to enter code |

### Content

| Method | Endpoint | Purpose |
|--------|---------|---------|
| GET | `/v1/watching/movies` | Unwatched movies |
| GET | `/v1/watching/serials` | Serials with new/unwatched episodes |
| GET | `/v1/watching?id=<id>` | Watch progress for a specific item |
| GET | `/v1/watching/marktime?id=...&video=...&time=...` | Save playback position |
| GET | `/v1/watching/toggle?id=...&video=...` | Toggle episode watched status |
| GET | `/v1/watching/togglewatchlist?id=...` | Toggle item in watchlist |
| GET | `/v1/items/<id>` | Item details + videos/seasons |
| GET | `/v1/items?type=...&sort=...` | List items by type |
| GET | `/v1/items/search?q=...` | Search items |
| GET | `/v1/bookmarks` | Bookmark folders |
| GET | `/v1/bookmarks/<id>?page=...` | Items in a bookmark folder |
| POST | `/v1/bookmarks/create` | Create bookmark folder |
| POST | `/v1/bookmarks/toggle-item` | Toggle item in bookmark folder |
| GET | `/v1/bookmarks/get-item-folders?item=...` | Get folders containing an item |
| GET | `/v1/history?page=...` | Watch history |
| GET | `/v1/tv` | Live TV channels |
| GET | `/v1/device/info` | Device info / settings |
| POST | `/v1/device/unlink` | Unlink device |
| GET | `/v1/user` | Current user info |

## Tizen Notes

### TV Remote Keys

- `TvKey` enum in `utils/platform.ts` maps key codes (Enter, Return, Backspace, Escape, arrows, Play, Pause, Stop, FF, RW, etc.)
- Tizen 2.3 requires `tizen.tvinputdevice.registerKey()` for media keys (Play, Pause, Stop, FF, RW)
- Navigation keys (arrows, Enter, Return) work without registration
- `PageKeys` class manages `keydown` listeners per page; each page binds on mount, unbinds on unmount

### Video Player

- HLS playback via hls.js + `<video>` element; HTTP (mp4) fallback uses `<video>` directly
- Quality/audio/subtitle selection via settings panel (`player/panel.ts`)
- Periodic position saving via `marktime` API
- Resume: if `time >= duration - 10`, resets to 0 (considers fully watched)
- Non-linear seek: step accelerates on key hold

### Navigation

- Custom spatial navigation via `gridMove()` (no LRUD library)
- `PageKeys` handles `keydown` on `window`; each page provides its own key handler
- `SidebarPage` base class integrates sidebar menu with page key handling
- `CARDS_PER_ROW = 4` — grid layout constant for card grids
