# KinoPub Tizen TV App

Клиент KinoPub для телевизоров Samsung (Tizen 2.3 / 3.0).

## API документация

- https://kinoapi.com/

## Архитектура

Одностраничное приложение (SPA) без фреймворков. Навигация между экранами реализована через простой роутер, переключающий видимость DOM-контейнеров. Все экраны рендерятся в `<div id="app">`.

```
src/
├── index.html              # Точка входа, подключение стилей и скриптов
├── css/
│   └── app.css             # Все стили (простой CSS, без препроцессоров)
├── ts/
│   ├── main.ts             # Инициализация приложения, роутер
│   ├── api/
│   │   ├── client.ts       # HTTP-клиент (обёртка над jQuery.ajax)
│   │   ├── auth.ts         # OAuth Device Flow (получение кода, polling, refresh)
│   │   ├── watching.ts     # /v1/watching/movies, /v1/watching/serials
│   │   └── items.ts        # /v1/items, /v1/items/<id>
│   ├── types/
│   │   ├── api.ts          # Типы ответов API (Item, Season, Episode, Video, Pagination и т.д.)
│   │   └── app.ts          # Внутренние типы приложения (Route, AppState)
│   ├── pages/
│   │   ├── login.ts        # Экран «Вход по коду»
│   │   ├── watching.ts     # Экран «Я смотрю» (сериалы + фильмы)
│   │   ├── movie.ts        # Карточка фильма (инфо + кнопка «Смотреть»)
│   │   ├── serial.ts       # Карточка сериала (инфо + сезоны → эпизоды)
│   │   └── player.ts       # Воспроизведение видео
│   ├── components/
│   │   ├── card.ts         # Компонент карточки (постер + название)
│   │   └── spinner.ts      # Индикатор загрузки
│   ├── nav/
│   │   └── navigation.ts   # Обёртка над LRUD для пространственной навигации
│   └── utils/
│       ├── storage.ts      # localStorage: токены, настройки
│       └── platform.ts     # Определение Tizen-платформы, обработка HW-кнопок пульта
```

### Потоки данных

```
[Пульт ДУ] → [Tizen Key Events] → [LRUD Navigation] → [Page Handler]
                                                              ↓
                                                        [API Client] → [api.service-kp.com]
                                                              ↓
                                                        [DOM Update (jQuery)]
```

## Целевые платформы

| Платформа | Web Engine | ES поддержка |
|-----------|-----------|--------------|
| Tizen 2.3 | Chromium ~28 | ES5 |
| Tizen 3.0 | Chromium ~47 | ES5 + частично ES6 |

**Важно:** Весь код (включая `node_modules`) компилируется в строгий ES5 через SWC. В рантайме не должно быть ни одной ES6+ конструкции — ни стрелочных функций, ни `const`/`let`, ни деструктуризации, ни template literals. Полифилы (`Promise`, `Object.assign`, `Array.from` и др.) поставляются через `core-js@3` с `mode: 'usage'` — SWC автоматически добавляет только те, которые реально используются в коде.

## Библиотеки

| Библиотека | Версия | Назначение |
|-----------|--------|-----------|
| **jQuery** | 2.x | DOM-манипуляции, AJAX-запросы, совместимость со старыми движками |
| **LRUD** | 3.x (`@bbc/lrud`) | Пространственная навигация (вверх/вниз/влево/вправо) для пульта ДУ |
| **hls.js** | 0.14.x | HLS-стриминг для браузеров без нативной поддержки HLS |
| **@swc/core** + **swc-loader** | 1.x | Транспиляция TS + ES6+ → строгий ES5 за один проход (включая node_modules) |
| **core-js** | 3.x | Полифилы ES6+ (`Promise`, `Object.assign`, `Array.from` и т.д.), инжектятся SWC через `mode: 'usage'` |

> **Почему hls.js, а не video.js:** Video.js тяжёлый (~500KB), тянет зависимости, проблемы с ES5. hls.js легковесный (~60KB), работает напрямую с `<video>`, достаточен для HLS-потоков KinoPub. Для HTTP-потоков (mp4) используем `<video>` напрямую.

## Сборка

- **Webpack** — бандлер (target: `['web', 'es5']`)
- **SWC** (`swc-loader`) — один лоадер заменяет и `ts-loader`, и `babel-loader`
  - Компилирует TypeScript и транспилирует в строгий ES5 за один проход
  - Обрабатывает **весь код**, включая `node_modules` (убирает ES6+ из зависимостей)
  - Быстрее Babel в ~20-70 раз (написан на Rust)
  - Конфиг в `.swcrc` или прямо в `webpack.config.js`
- **core-js@3** — полифилы (`Promise`, `Object.assign`, `Array.from` и т.д.) через `mode: 'usage'`

```
.ts и .js (включая node_modules) → swc-loader (TS + ES5) → webpack bundle → dist/app.js
```

> **Почему SWC, а не Babel:** Один лоадер вместо двух (`ts-loader` + `babel-loader`), минимальный конфиг, быстрая сборка. Транспилирует TypeScript, убирает ES6+ синтаксис из зависимостей, инжектит полифилы — всё за один проход.

## API KinoPub (используемые эндпоинты)

Base URL: `https://api.service-kp.com`

### Аутентификация (OAuth Device Flow)

| Метод | Endpoint | Назначение |
|-------|---------|-----------|
| POST | `/oauth2/device?grant_type=device_code&client_id=...&client_secret=...` | Получение `user_code` для отображения на экране |
| POST | `/oauth2/device?grant_type=device_token&client_id=...&client_secret=...&code=...` | Polling: ожидание ввода кода пользователем |
| POST | `/oauth2/token?grant_type=refresh_token&...&refresh_token=...` | Обновление `access_token` |

### Контент

| Метод | Endpoint | Назначение |
|-------|---------|-----------|
| GET | `/v1/watching/movies` | Недосмотренные фильмы |
| GET | `/v1/watching/serials` | Сериалы с новыми/недосмотренными эпизодами |
| GET | `/v1/items/<id>` | Детальная информация + список видео/сезонов |
| GET | `/v1/watching?id=<id>` | Прогресс просмотра для конкретного item |
| GET | `/v1/watching/marktime?id=...&video=...&time=...` | Сохранение позиции просмотра |

## Экраны

### 1. Вход по коду (`/login`)
- Запрос `device_code` → отображение `user_code` и `verification_uri`
- Таймер обратного отсчёта (`expires_in`)
- Polling каждые `interval` секунд до получения `access_token`
- После успешной авторизации → сохранение токенов в `localStorage` → переход на «Я смотрю»

### 2. Я смотрю (`/watching`)
- Два раздела: «Сериалы» и «Фильмы» (горизонтальные ряды карточек)
- Карточка: постер + название + прогресс (для сериалов: «5 из 10», для фильмов: карточка без прогресса)
- LRUD-навигация: стрелки влево/вправо по карточкам, вверх/вниз между разделами
- Enter → переход на карточку детали

### 3. Карточка фильма (`/movie/:id`)
- Постер, название (рус/ориг), год, страны, жанры
- Рейтинги: KinoPub, КиноПоиск, IMDb
- Описание (plot)
- Кнопка «Смотреть» (с позиции, если есть прогресс)
- Для multi-фильмов: список частей
- LRUD-навигация по элементам

### 4. Карточка сериала (`/serial/:id`)
- Постер, название (рус/ориг), год, страны, жанры
- Рейтинги: KinoPub, КиноПоиск, IMDb
- Описание (plot)
- Список сезонов (горизонтальный ряд / табы)
- Список эпизодов выбранного сезона (вертикальный список с прогрессом просмотра)
- LRUD-навигация: влево/вправо по сезонам, вверх/вниз по эпизодам, Enter → плеер

### 5. Плеер (`/player/:id/:video` или `/player/:id/:season/:episode`)
- Полноэкранное воспроизведение через `<video>` + hls.js
- Выбор качества (из `files[]`)
- Периодическое сохранение позиции (`marktime`)
- Управление пультом: Play/Pause, перемотка, стоп (Return → выход из плеера)

## Особенности Tizen (из reference-реализации `old/bundle.min.from.jsnice.js`)

### Кнопки пульта

Enum клавиш, используемый в старом приложении:
```
Right=0, Left=1, Up=2, Down=3, Enter=4, Return=5,
Key0..Key9 (6-15), Red=16, Green=17, Yellow=18, Blue=19,
Play=20, Pause=21, PlayPause=22, Stop=23, Rec=24, Ff=25, Rw=26,
Tools=27, ChannelUp=28, ChannelDown=29, ChannelList=30, PreCh=31,
Teletext=32, FavoriteChannel=33, Exit=34, Info=35, AspectRatio=36, Subtitle=37
```

- Маппинг `keyCode → действие` получается от устройства через `device.getControlKeys()` и передаётся в контроллер через `control.setKeys()`
- Tizen 2.3 использует `tizen.tvinputdevice.registerKey()` / `tizen.tvinputdevice.getSupportedKeys()` для регистрации медиа-кнопок (Play, Pause, Stop, FF, RW и т.д.)
- Навигационные клавиши (стрелки, Enter, Return) работают без регистрации
- `keydown` слушатель на `window`, отдельный `keyup` для debounce (защита от повторного Enter)
- Стек обработчиков: каждая страница добавляет свой listener через `control.on()`, убирает через `control.off()`. Return обработан как `backKeyDown()`

### Видеоплеер

- **Два типа плеера**: `TizenPlayer` (через `webapis.avplay` API — нативный плеер Samsung) и HTML5 `<video>` (fallback)
- **Стримы**: сначала пробует HLS (`files[].url.hls`), при ошибке fallback на HTTP (`files[].url.http`)
- **Состояния**: Idle, Playing, Paused — управление через `play()`, `pause()`, `resume()`, `stop()`, `seek()`
- **Перемотка**: нелинейная — `step = 10 + Math.pow(Math.min(count, 3000), 3) / 1000`, ускоряется при удержании Left/Right
- **Rw/Ff**: переход на предыдущий/следующий эпизод для сериалов
- **Marktime**: периодическое сохранение позиции просмотра на сервер
- **Возобновление**: если `time >= duration - 10`, сбрасывает позицию на 0 (считает досмотренным)

### Навигация (LRUD-подобная)

- Кастомная реализация пространственной навигации (не библиотека @bbc/lrud)
- События: `nav_click` (Enter на элементе), `nav_key` (любая клавиша на элементе)
- Фокус отслеживается через `self.element`, переключается методом `current(newEl, oldEl, direction)`
- Элементы могут быть `disabled` или `hidden` — пропускаются при навигации

## План задач

### Фаза 1: Каркас проекта
- [x] `.gitignore` и `README.md`
- [ ] Инициализация npm, установка зависимостей
- [ ] Конфигурация TypeScript (`tsconfig.json`, target ES5)
- [ ] Конфигурация Webpack
- [ ] `index.html` с базовой разметкой
- [ ] Базовые стили (`app.css`)
- [ ] Tizen `config.xml`

### Фаза 2: Инфраструктура
- [ ] HTTP-клиент (`api/client.ts`)
- [ ] Типы API (`types/api.ts`, `types/app.ts`)
- [ ] Хранилище токенов (`utils/storage.ts`)
- [ ] Платформа и кнопки пульта (`utils/platform.ts`)
- [ ] Роутер (`main.ts`)
- [ ] LRUD-навигация (`nav/navigation.ts`)

### Фаза 3: Экраны
- [ ] Вход по коду (`pages/login.ts`)
- [ ] «Я смотрю» (`pages/watching.ts`)
- [ ] Карточка фильма (`pages/movie.ts`)
- [ ] Карточка сериала (`pages/serial.ts`)
- [ ] Плеер (`pages/player.ts`)

### Фаза 4: Полировка
- [ ] Обработка ошибок сети / истёкших токенов
- [ ] Автообновление `access_token` через `refresh_token`
- [ ] Тестирование на Tizen Emulator
- [ ] Упаковка в `.wgt` для Samsung TV
