# План работ: обновление hls.js

Описание проблемы, анализ платформ и риски — в [hls-upgrade.md](hls-upgrade.md).
Здесь только конкретные шаги.

## Фаза 1 — vendor-бандлы, loader, настройка, кнопка reload

Реализовано в `af6bcfd Add HLS legacy/modern bundle loader and Старый телевизор setting`.
Проверено на Tizen 3.0 и Android TV: modern hls.js (1.6.x) стартует и играет H.264.

- [x] **Vendor-бандлы**
  - [x] `vendor/hls-legacy.min.js` — `node_modules/hls.js/dist/hls.js` (0.14.17)
  - [x] `vendor/hls-modern.min.js` — `node_modules/hls-modern/dist/hls.min.js`
    (алиас `hls-modern: "npm:hls.js@^1.5.0"` в `package.json`), копируется
    готовым минифицированным файлом мимо SWC
  - [x] Исключено из `escheck` по факту: `es-check es5 dist/release/app.*.js`
    не трогает `vendor/`

- [x] **Настройка «Старый телевизор»**
  - [x] `storage.ts`: `isLegacyHls()` / `setLegacyHls()`, default = `true`
    (`val === null || val === '1'`)
  - [x] `settings.ts`: новый пункт `_legacyHls` (checkbox)
  - [x] При переключении — диалог перезапуска → `location.reload()`
  - [x] Скрытие пункта на forced-legacy платформах через `isLegacyForced()`
    (Chrome < 47, webOS без Chrome в UA)

- [x] **Кнопка «Перезагрузить приложение»**
  - [x] `_reloadApp` рядом с версией, тип `action`, диалог подтверждения

- [x] **Динамический загрузчик hls.js**
  - [x] `index.html`: инлайн IIFE + `document.write` выбирает бандл по
    `kp_legacy_hls` из `localStorage`
  - [x] В загрузчик уже встроен автодетект Chrome < 47 / webOS без Chrome
    (обгоняет Фазу 5, но не мешает)

- [x] **Три диагностических лога**
  - [x] `[env] ua/tizen/mse hvc1/hev1/avc1` в `main.ts`
  - [x] `[hls] version=... mode=... isSupported=...` в `HlsEngine`
  - [x] `[settings] legacy hls toggled: old→new, reloading` в `settings.ts`

## Фаза 2 — HlsAdapter и рефакторинг player

- [x] **Собрать реальный список различий 0.14 vs 1.5+**
  Проверено по фактическому использованию в `hls-engine.ts`, `tv-player.ts`,
  `hls-utils.ts`, `overlay.ts`. Итог: API совпадает ~на 99%.
  - События (`MEDIA_ATTACHED`, `MANIFEST_LOADING/LOADED/PARSED`, `LEVEL_*`,
    `FRAG_LOADING/LOADED/BUFFERED`, `ERROR`) — одинаковые имена и payload.
  - Инстанс-методы (`loadSource`, `attachMedia`, `destroy`, `startLoad`,
    `stopLoad`, `recoverMediaError`, `trigger`, `on`) — те же сигнатуры.
    `startLoad(pos, skipSeekToStartPos?)` в 1.5+ имеет доп. параметр,
    обратно совместим.
  - Статика (`Hls.version`, `Hls.isSupported`, `Hls.Events`, `Hls.ErrorTypes`,
    `Hls.ErrorDetails`) — идентично.
  - Config-ключи, которые мы реально ставим (`maxBufferLength`, `maxMaxBufferLength`,
    `maxBufferHole`, `highBufferWatchdogPeriod`, `nudgeMaxRetry`, `abrEwma*`,
    `fragLoadingMaxRetry`, `manifestLoadingMaxRetry`, `levelLoadingMaxRetry`,
    `autoStartLoad`) — все живы в 1.5+.
  - `levels[]` поля (`bitrate`, `height`, `width`, `videoCodec`, `audioCodec`,
    `name`) — совместимы.
  - **Реальные отличия только в `ErrorData`**:
    - 0.14: `{type, details, fatal, frag?, reason?, response?: {code, text}}`
    - 1.5+: убраны `reason` и `response.code`, HTTP-статус теперь в
      `context.response.status`; добавлены `error: Error`, `errorAction`, `level`.
  - `hls.trigger(BUFFER_FLUSHING, {startOffset, endOffset})` работает и там, и там.
  - `patch-hls.js` для modern не нужен — публичных событий хватает,
    плюс 1.5+ использует worker агрессивнее и стринговые патчи по минифицированному
    бандлу всё равно сломаются.

- [x] **Стратегия адаптера: абстрактный базовый класс**
  Общего кода намного больше, чем различий — оборачивать `ErrorData` через
  один виртуальный метод проще, чем дублировать конфиг-сборку, подписки и
  делегирование `levels[]`.
  ```
  abstract class HlsAdapter {
    protected hls: Hls;
    // общее: конструктор, loadSource/attachMedia/destroy, startLoad/stopLoad,
    // recoverMediaError, подписки на Events.*, проброс levels[], trigger(BUFFER_FLUSHING)
    protected abstract normalizeError(raw: unknown): HlsError;
    // + при необходимости abstract buildConfig() — если дефолты разойдутся
  }
  class HlsAdapterLegacy extends HlsAdapter { normalizeError(raw) { /* reason, response.code */ } }
  class HlsAdapterModern extends HlsAdapter { normalizeError(raw) { /* context.response.status */ } }
  ```
  `HlsError` — свой узкий тип (`type`, `details`, `fatal`, `httpStatus?`, `fragUrl?`,
  `message`), ровно то, что реально читают `hls-error.ts` и `hls-engine.ts`,
  а не полный upstream `ErrorData`.

- [x] **Реализовать `HlsError`** — узкий тип ошибки плеера (см. выше)
- [x] **Реализовать базовый `HlsAdapter`** — общий код без `normalizeError`
- [x] **Реализовать `HlsAdapterLegacy`** — `normalizeError` по `data.reason`/`data.response?.code`,
  плюс legacy-only start-seek workaround (`startPlayback` / `onVideoSeeking` / `onVideoCanplay`)
- [x] **Реализовать `HlsAdapterModern`** — `normalizeError` по `data.context?.response?.status`,
  `data.error?.message`; `startPlayback` — тривиальный `hls.startLoad(startPos)`
- [x] **Перевести на адаптер**: `hls-engine.ts`, `player.ts`, `player/overlay.ts`,
  `player/error-view.ts`, `player/video-bindings.ts`, `utils/hls-utils.ts`
  (коммит `de4dc84`). `tv-player.ts` — отдельно (остался прямой `Hls`).

- [x] **Типы**
  - Оставили `@types/hls.js@0.13` как базовый тайпинг — он покрывает и legacy,
    и то подмножество API modern, которое мы реально используем.
  - Ambient-файл `ts/types/hls.d.ts` мёрджит `interface Hls` с глобальным
    `declare class Hls` из `@types/hls.js`, чтобы дотипизировать
    `trigger(BUFFER_FLUSHING, …)` без `as unknown`.
  - На границе адаптера payload'ы событий принимаются как `unknown` и сужаются
    per-field внутри `onXxx`-методов и `normalizeError`. Это честно отражает
    рантайм-расхождения (modern добавляет поля вроде `error`, `errorAction`,
    `context.response.status`) и не тянет внутренние типы hls.js@1.5+ в проект.

- [x] **Start seek без костылей на modern**
  - Вся legacy-логика (`pendingStartSeek` / `firstFragSnapped` / ручной
    `BUFFER_FLUSHING` / snap в `onVideoSeeking`+`onVideoCanplay`) переехала
    в `HlsAdapterLegacy.startPlayback`/`onVideoSeeking`/`onVideoCanplay`.
  - `HlsAdapterModern` использует базовый `startPlayback`, который делает
    просто `hls.startLoad(startPos)`. Никаких костылей.
  - `HlsEngine` держит только делегации `adapter.onVideoSeeking/onVideoCanplay`.
  - Проверить на Этапе 2 Фазы 4, что A/V sync на Tizen 3.0+/Android TV при
    старте с ненулевой позиции действительно в порядке. Если всплывёт —
    завести отдельную задачу, не тащить legacy-обходы в modern по умолчанию.

## Фаза 3 — HEVC/4K (закрыто)

Проверено на реальном железе, подробности в `doc/decision-log.md`:

- [x] **HEVC 1080p на Tizen 3.0 через modern hls.js** — стабильно, без stall'ов
  (запись `2026-04-15 21:46`). `pinQualityLevel` с `preferHevc=true` корректно
  выбирает hvc1-вариант, битрейт ~40% меньше avc1.
- [x] **HEVC 1080p на Tizen 3.0 через legacy hls.js 0.14** — работает, но с
  периодическими `bufferStalledError` (запись `2026-04-15 14:00`). Это и был
  главный мотив апгрейда, modern его чинит.
- [x] **4K HEVC на Tizen 3.0** — ограничение платформы: звук идёт, картинка
  зависает (запись `2026-04-15 14:30`). Аппаратный декодер Tizen 3.0 не тянет
  4K HEVC Level 5. Отдельной задачи не заводим — это не баг плеера.

## Фаза 4 — тестирование

### Этап 0 — Baseline до раскатки (своё железо)

Делать **до** мержа hls-upgrade в master.

Сценарий на каждом устройстве (Tizen 2.3, Tizen 3.0, Android TV):
- [ ] Логин → Watching → деталь сериала → плеер
- [ ] 1080p H.264, 5 минут без взаимодействия, потом 5 seek'ов
  (+30с, −30с, +2 мин, в конец, в начало). Закрыть
- [ ] **Только Tizen 3.0 и Android TV**: 1080p HEVC, 10 минут без взаимодействия.
  Посчитать частоту `bufferStalledError` в логах
- [ ] Записать URL логов в `doc/decision-log.md` с пометкой
  `baseline pre-hls-upgrade, <device>, <date>`

**Время**: ~40 минут на все три устройства.

### Этап 1 — Раскатка в master с default=legacy

После того как loader, адаптер, настройка и три диагностических лога готовы:

- [ ] Собрать release с `isLegacyHls() === true` по умолчанию
- [ ] **Tizen 2.3**: повторить полный сценарий Этапа 0. Любая регрессия — блокер
- [ ] **Tizen 3.0**: то же самое (default legacy → 0.14)
- [ ] **Android TV**: то же самое (default legacy → 0.14)
- [ ] Если всё PASS — мержим в master, релизим виджет через штатный апдейт

**Что смотреть**: ничего не должно поменяться по сравнению с baseline.
Если поменялось — loader или setting сломал legacy путь, modern даже не трогали.

**Время**: 30 минут.

### Этап 2 — Параллельная проверка modern на своём железе

- [ ] На Tizen 3.0: выключить «Старый телевизор» → перезапуск → сценарии A, B, C, E
  (4K пропускаем, заведомо не работает)
- [ ] На Android TV: выключить «Старый телевизор» → перезапуск → сценарии A–E
  включая 4K

**Главный вопрос на Tizen 3.0**: запустился ли вообще hls.js 1.5 на Chrome 47.
Если да — сравнить частоту stalled errors с baseline Этапа 0.

**Время**: ~1 час.

### Этап 3 — Тестировщик на Tizen 5.5 (главный сценарий)

Инструкция выдаётся тестировщику:

---

> 1. Открыть приложение KinoPub.
> 2. Settings → найти пункт **«Старый телевизор»** → выключить.
> 3. Подтвердить перезапуск приложения (диалог появится сам).
> 4. После перезапуска — выполнить сценарии ниже не закрывая приложение.
>    Логи уходят на сервер автоматически.
>
> **Сценарий A — навигация (3 минуты).**
> Watching → открыть любой сериал → закрыть → Novelties → открыть любой фильм
> → закрыть → Settings → выйти в Watching.
> *Что должен увидеть*: всё работает как раньше, фокус восстанавливается на
> Back, ничего не зависает.
>
> **Сценарий B — Full HD H.264 (10 минут).**
> Открыть любой фильм 2010–2015 года, выбрать качество **1080p**. Play.
> **Ждать 5 минут, не трогая пульт.** Потом 5 перемоток: +30с, −30с, +2 мин,
> в самый конец, обратно в начало. Закрыть плеер.
> *Что должен увидеть*: видео не зависает, перемотки срабатывают за 1–2 сек,
> после перемотки сразу играет.
>
> **Сценарий C — Full HD HEVC сериал (10 минут).**
> Открыть любой сериал 2023–2024 года, любую серию, качество **1080p**. Play.
> **Смотреть 10 минут подряд, не трогая пульт.**
> *Что должен увидеть*: видео идёт без зависаний и чёрных кадров. Если зависает —
> записать **точное время** (минута:секунда от начала воспроизведения).
>
> **Сценарий D — 4K HEVC (10 минут) — главный сценарий.**
> Открыть свежий фильм с 4K (помечен **2160p**). Выбрать **2160p**. Play.
> **Смотреть 5 минут.** Потом одна перемотка вперёд на 5 минут,
> ещё 3 минуты воспроизведения.
> *Что должен увидеть*: картинка в полном разрешении (не пиксельная мазня),
> нет «звук есть, видео фриз», нет чёрных кадров. Если есть проблема —
> точное время.
>
> **Сценарий E — переключение серий (5 минут).**
> Открыть сериал → серию → перемотать к концу (за 30 сек до конца) → дождаться
> автоперехода → в следующей серии посмотреть 1 минуту → закрыть.
> *Что должен увидеть*: автопереход срабатывает, marktime сохраняется.
>
> **Сценарий F — возврат на legacy.**
> Settings → **«Старый телевизор» включить** → перезапуск → повторить **только
> сценарий D** (4K). На legacy 4K не работает — это ожидаемо. Нужно, чтобы
> убедиться, что переключение настройки реально сменило версию hls.js.
>
> Сообщить: «всё ОК» / «проблема в сценарии X на минуте Y».

---

**Что смотреть в логах**:

| Сценарий | На что смотреть | PASS-критерий |
|----------|----------------|---------------|
| Стартовый лог | `[hls] version=1.5.x mode=modern` после выключения настройки | версия сменилась |
| A | ошибки навигации, фокуса | нет ошибок в логе |
| B | `bufferStalledError` на 1080p H.264 | нет или единичные |
| C | частота `bufferStalledError` на 1080p HEVC | **≈0**, было ~1 за 30 сек на 0.14 |
| D | `bufferStalledError`, `mediaError`, `fragLoadError`, отказ декодера на 4K | нет ошибок, видео идёт |
| E | `MEDIA_ATTACHED`, `MANIFEST_PARSED`, marktime | события приходят, marktime в API |
| F | `[hls] version=0.14.x mode=legacy` после включения настройки | версия откатилась |

Если C показывает PASS, а D — FAIL, значит modern починил buffer management,
но MSE 4K не тянет даже Tizen 5.5. Это не блокер для мержа — выигрыш на 1080p
HEVC уже окупает обновление. 4K остаётся открытым вопросом.

**Время тестировщика**: 40–50 минут одним сеансом.
**Время разбора логов**: 30–60 минут.

### Что записывать каждый раз

Для каждого сеанса в `doc/decision-log.md`:
- Дата, устройство (модель + версия OS + версия Chrome из стартового лога),
  git SHA сборки
- Этап, сценарий, версия hls.js (legacy/modern из стартового лога плеера)
- URL логов на `yobapub.3po.su/s/logs`
- PASS / FAIL / PARTIAL + что именно. Для HEVC — частота stalled errors в минуту

## Фаза 5 — runtime-fallback и доводка

- [x] **Runtime-детект «modern не взлетел»**
  - В `index.html` второй инлайн-скрипт после `document.write` проверяет
    `typeof Hls === 'undefined' || typeof Hls.isSupported !== 'function'`.
    Если true — записывает `kp_legacy_hls=1` + `kp_legacy_hls_forced=1`
    в localStorage и делает `location.reload()`.
  - Защита от цикла: загрузчик проверяет `kp_legacy_hls_forced` — если стоит,
    грузит legacy сразу, не пробуя modern.

- [x] **`!Hls.isSupported()` в плеерах**
  - `hls-engine.ts`: `load()` возвращает `false`, если MSE не поддержан.
    `player.ts` показывает «Устройство не поддерживает воспроизведение видео».
  - `tv-player.ts`: показывает `tplErrorScreen` с тем же сообщением.

- [x] **Тост «устройство не тянет HEVC»**
  - В `hls-engine.ts`: счётчик `hevcStallCount` при `bufferStalledError`
    на hvc1/hev1-уровне с `preferHevc === true`. Порог: 5. По достижении —
    одноразовый callback `onHevcNotSupported`.
  - `player.ts` показывает тост «Устройство не тянет HEVC, выключите
    в настройках» (7 сек, потом убирается).

- [x] **Скрытие пункта «Старый телевизор»** на forced-legacy платформах
  - `storage.isLegacyHlsForced()` проверяет `kp_legacy_hls_forced`.
  - `settings.ts` прячет пункт, если флаг стоит.
