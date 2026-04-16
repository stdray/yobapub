# План работ: обновление hls.js

Описание проблемы, анализ платформ и риски — в [hls-upgrade.md](hls-upgrade.md).
Здесь только конкретные шаги.

## Фаза 1 — vendor-бандлы, loader, настройка, кнопка reload

- [ ] **Vendor-бандлы**
  - [ ] `vendor/hls-legacy.min.js` — текущий 0.14.x (с диагностическими патчами)
  - [ ] `vendor/hls-modern.min.js` — hls.js 1.5+, копируется из
    `node_modules/hls.js/dist/hls.min.js` напрямую через `CopyWebpackPlugin`,
    **мимо SWC** (ES2015+ сохраняется)
  - [ ] Исключить `hls-modern.min.js` из `npm run escheck`

- [ ] **Настройка «Старый телевизор»**
  - [ ] `storage.ts`: `isLegacyHls()` / `setLegacyHls()`, **default = `true`**
  - [ ] `settings.ts`: новый пункт в клиентских настройках
  - [ ] При переключении — диалог «Настройка применится после перезапуска
    приложения. Перезапустить сейчас?» → `location.reload()` по подтверждению
  - [ ] Гейты по платформам (Chrome < 47, webOS 1.x–2.x, canDecodeHevc) —
    **не сейчас**, перенесено в Фазу 5. Сначала тестируем «как есть»

- [ ] **Кнопка «Перезагрузить приложение»**
  - [ ] Расположить рядом с версией приложения в `settings.ts`
  - [ ] По нажатию — диалог подтверждения → `location.reload()`

- [ ] **Динамический загрузчик hls.js**
  - [ ] Убрать `<script src="vendor/hls.min.js">` из `index.html`
  - [ ] Инлайн-бутстрап в `index.html`: читает `kp_legacy_hls` из
    `localStorage` напрямую (без импорта `storage.ts`), выбирает
    `hls-legacy.min.js` или `hls-modern.min.js` через `document.write`.
    **Только флаг, без автодетекта платформы** — гейты в Фазе 5
  - [ ] Если после загрузки `Hls.isSupported() === false` — писать ошибку в лог
    и показывать существующий экран ошибки плеера. Никаких подсказок
    пользователю про «Старый телевизор»

- [ ] **Три диагностических лога**
  - [ ] `[env]` (один раз при старте `main.ts`):
    ```
    [env] ua=<navigator.userAgent>
    [env] tizen=<tizen.systeminfo.platform.version или 'n/a'>
    [env] mse hvc1=<isTypeSupported('video/mp4; codecs="hvc1.1.6.L150.B0"')>
    [env] mse hev1=<isTypeSupported('video/mp4; codecs="hev1.1.6.L150.B0"')>
    [env] mse avc1=<isTypeSupported('video/mp4; codecs="avc1.640028"')>
    ```
  - [ ] `[hls] version=<Hls.version> mode=<legacy|modern> isSupported=<bool>`
    при инициализации плеера
  - [ ] `[settings] legacy hls toggled: <old>→<new>, reloading` при смене настройки

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

- [ ] **Реализовать `HlsError`** — узкий тип ошибки плеера (см. выше)
- [ ] **Реализовать базовый `HlsAdapter`** — общий код без `normalizeError`
- [ ] **Реализовать `HlsAdapterLegacy`** (обёртка над существующим кодом)
  - `normalizeError`: читать `data.reason`, `data.response?.code`
- [ ] **Реализовать `HlsAdapterModern`**
  - `normalizeError`: читать `data.context?.response?.status`, игнорировать
    `errorAction`/`error` (или пробрасывать `data.error.message` в `HlsError.message`)
- [ ] **Перевести на адаптер**:
  - [ ] `player.ts`
  - [ ] `player/hls.ts`
  - [ ] `player/panel.ts`
  - [ ] `utils/hls-proxy.ts`
  - [ ] `utils/hls-error.ts`

- [ ] **Типы**
  - [ ] `@types/hls.js@0.13` оставляем для legacy-имплементации
  - [ ] Для modern сначала пробуем выдернуть минимально необходимое подмножество
    из встроенных типов `hls.js@1.5+/dist/hls.js.d.ts`
  - [ ] Если это тянет много внутренних типов — пишем свой минимальный
    `HlsLike`-интерфейс (~30–50 членов). `unknown` + type guards на границе адаптера

- [ ] **Start seek без костылей на modern**
  - На legacy мы стартуем с `currentTime=0`, ждём первый фрагмент в SourceBuffer,
    прыгаем на `resumeTime` и вручную флашим `[0..target-1]` через
    `BUFFER_FLUSHING`. Причина — Tizen 2.3: `_seekToStartPos` в 0.14 стреляет
    seek во время прогрева декодера и ломает A/V sync (см. `buildBaseHlsConfig`
    и decision log). Поэтому `cfg.startPosition` не используем.
  - На modern этих замуток быть не должно: `HlsAdapterModern` стартует сразу
    с `config.startPosition = resumeTime` (или `hls.startLoad(resumeTime)`),
    никакого стартового seek из нуля, никакого ручного `BUFFER_FLUSHING`,
    никакого `pendingStartSeek`/`firstFragSnapped`. Вся эта логика живёт только
    в `HlsAdapterLegacy`.
  - Проверить на Этапе 2 Фазы 4, что A/V sync на Tizen 3.0+/Android TV при
    старте с ненулевой позиции действительно в порядке (ради чего и затевали
    legacy-костыль). Если всплывёт — завести отдельную задачу, не тащить
    legacy-обходы в modern по умолчанию.

- [ ] **`patch-hls.js`**
  - [ ] Старый патч оставляем только для legacy-бандла
  - [ ] На modern **сначала не патчим**: включить подробное логирование публичных
    событий hls.js (`Events.ERROR`, `FRAG_LOADED`, `BUFFER_*`, seek-related)
    в `HlsAdapterModern`
  - [ ] Если встроенной диагностики не хватает — отдельный `patch-hls-modern.js`

## Фаза 3 — HEVC/4K

- [ ] **Серверные флаги на современных ТВ**
  - [ ] При загрузке настроек (`/v1/device/settings`) проверить, что `supportHevc`,
    `supportHdr`, `support4k` включены

- [ ] **Проверка hls4 стриминга с HEVC**
  - [ ] На Tizen 3.0+ с hls.js 1.5+ выбрать 4K-контент
  - [ ] Убедиться, что hls.js парсит HEVC-манифест, `pinQualityLevel` работает,
    видео декодируется

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

## Фаза 5 — гейты, whitelist'ы и финальная полировка

Всё, что раньше было разбросано как «а ещё надо проверить…» и требовало
предварительных предположений о платформах, собрано здесь. **Делается только
после Фаз 1–4**, когда по `doc/decision-log.md` уже видно, что реально
работает, а что нет. До этого — тестируем как есть, без страховок.

- [ ] **Платформенный whitelist для modern**
  - [ ] Автодетект legacy-платформ в инлайн-загрузчике `index.html`
    (Chrome < 47, webOS 1.x–2.x без Chrome в UA и что ещё вылезет в Фазе 4)
  - [ ] На таких платформах `kp_legacy_hls` игнорируется — всегда legacy
  - [ ] Опционально: сменить default `isLegacyHls()` на `false` для whitelisted
    современных платформ, сохранив «Старый телевизор» как escape hatch

- [ ] **Скрытие пункта «Старый телевизор» там, где он бесполезен**
  - [ ] На forced-legacy платформах пункт не показывается в `settings.ts`
  - [ ] Логика определения — та же функция, что в загрузчике, вынести в
    общий модуль (или дублировать, если импорт из settings неудобен)

- [ ] **Гейт HEVC по платформе**
  - [ ] `platform.canDecodeHevc()`: явный whitelist/blacklist по версии OS
    (Tizen ≤ 3.0 → false, Tizen ≥ 4 → true, Android TV → true, webOS —
    решить по данным Фазы 4, десктоп-Chrome — по `isTypeSupported`)
  - [ ] `pinQualityLevel` при modern предпочитает hvc1/hev1 уровень только
    если `canDecodeHevc() && storage.isSupportHevc()`
  - [ ] Кэшировать `supportHevc` в `storage.ts` при загрузке
    `/v1/device/settings`, чтобы плеер мог читать его синхронно

- [ ] **Диагностика fallback-случаев**
  - [ ] Если modern загрузился, но `Hls.isSupported() === false` — лог
    `[hls] unsupported, falling back` и принудительный reload в legacy
    (`setLegacyHls(true) + reload`)
  - [ ] Если `canDecodeHevc()` врёт (HEVC фактически не декодируется —
    `bufferStalledError` подряд или чёрный кадр на HEVC уровне) —
    понизить приоритет hvc1 для этой сессии и перелогин уровня на avc1

- [ ] **Очистка диагностических логов**
  - [ ] Сворачивание `FRAG_LOADING`/`FRAG_BUFFERED` до debug-уровня
    после стабилизации
  - [ ] Удаление временных ct-патчей из `patch-hls.js`, если Фаза 4 не
    вскрыла новых случаев seek-аномалий
