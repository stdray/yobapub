# ТВ (Live TV Channels)

## Описание
Страница с живыми ТВ-каналами. Отображает список каналов с логотипами, при выборе — переход в плеер с HLS-потоком. EPG (программа передач) в оригинале отсутствует — только прямая трансляция.

## Анализ оригинала (bundle.from.jsnice.js)

### Список каналов

**Ключевые строки:** 51048-51064

**API:**
```
GET /v1/tv
```

**Ответ:**
```typescript
{
  channels: Array<{
    id: number;
    title: string;       // "Первый канал", "ICTV" и т.д.
    logos: {
      s: string;         // URL маленького логотипа
    };
    stream: string;      // HLS-поток (https://...)
  }>
}
```

Каналы отображаются в виде сетки с логотипами (posterUrl = logos.s, text = title).

### Плеер каналов

**Ключевые строки:** 31834-31973

При выборе канала — переход в отдельную сцену `Channel` с параметром `{ id }`.

**Конструирование URL потока (строки 31887-31900):**
```javascript
var url = channel.stream.replace("https://", "http://");
var proto = useProxy ? "http" : "https";
var finalUrl = proto + "://kpstv.net/api/hls2-fixer-channel.m3u8?url=" + btoa(url);
```

Оригинал пропускает поток через прокси `hls2-fixer-channel.m3u8`. В нашем проекте уже есть аналогичный плеер (`pages/player.ts`), можно адаптировать.

**Управление пультом:**
- Enter — пауза/воспроизведение
- Stop — выход
- Стрелки — не используются в ТВ-плеере (нет перемотки для live)

---

## План реализации

### Этап 1: Список каналов

#### 1.1 Типы

**Файл:** `src/front/ts/types/api.ts`

Добавить:
```typescript
export interface TvChannel {
  id: number;
  title: string;
  logos: {
    s: string;
  };
  stream: string;
}

export interface TvChannelsResponse {
  channels: TvChannel[];
}
```

**Файл:** `src/front/ts/types/app.ts`

Добавить в `RouteName`:
```typescript
'tv' | 'tv-player'
```

Добавить в `RouteParams`:
```typescript
channelId?: number;
channelTitle?: string;
channelStream?: string;
tvFocusedIndex?: number;
```

#### 1.2 API-модуль

**Файл:** `src/front/ts/api/tv.ts` (создать)

```typescript
import { apiGetWithRefresh } from './client';

export function getTvChannels(): JQueryDeferred<any> {
  return apiGetWithRefresh('/v1/tv');
}
```

#### 1.3 Страница списка каналов

**Файл:** `src/front/ts/pages/tv.ts` (создать)

```typescript
import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { TvChannel } from '../types/api';
import { navigate, goBack, setParams } from '../router';
import { TvKey } from '../utils/platform';
import { pageKeys, showSpinnerIn, clearPage, scrollIntoView } from '../utils/page';
import { gridMove } from '../utils/grid';
import { proxyUrl } from '../utils/storage';
import { getTvChannels } from '../api/tv';

var $root = $('#page-tv');
var keys = pageKeys();

var channels: TvChannel[] = [];
var focusedIndex = 0;
```

**Шаблоны:**

Можно использовать `tplCard` из `utils/templates.ts`, но карточки каналов чуть отличаются (логотип вместо постера, без badge). Варианты:
1. Использовать `tplCard` как есть (логотип в место постера) — проще
2. Сделать отдельный шаблон для канала — красивее

Рекомендация: начать с `tplCard`, при необходимости сделать отдельный шаблон.

```typescript
var tplChannelCard = doT.template(
  '<div class="card card--channel" data-id="{{=it.id}}">' +
    '<div class="card__poster card__poster--channel">' +
      '<img src="{{=it.logo}}" alt="">' +
    '</div>' +
    '<div class="card__title">{{=it.title}}</div>' +
  '</div>'
);

var tplPage = doT.template(
  '<div class="watching">' +
    '<div class="watching__section-title">Телеканалы</div>' +
    '<div class="watching__grid">{{=it.cards}}</div>' +
  '</div>'
);
```

**Рендеринг:**

```typescript
function render(): void {
  if (channels.length === 0) {
    $root.html('<div class="watching">' + tplEmptyText({ text: 'Нет каналов' }) + '</div>');
    return;
  }
  var cards = '';
  for (var i = 0; i < channels.length; i++) {
    cards += tplChannelCard({
      id: channels[i].id,
      logo: proxyUrl(channels[i].logos.s),
      title: channels[i].title
    });
  }
  $root.html(tplPage({ cards: cards }));
  updateFocus();
}
```

**Навигация:**

```typescript
function handleKey(e: JQuery.Event): void {
  var dir = e.keyCode === TvKey.Right ? 'right' as const
    : e.keyCode === TvKey.Left ? 'left' as const
    : e.keyCode === TvKey.Down ? 'down' as const
    : e.keyCode === TvKey.Up ? 'up' as const
    : null;
  if (dir) {
    var next = gridMove(focusedIndex, channels.length, dir);
    if (next >= 0) { focusedIndex = next; updateFocus(); }
    e.preventDefault();
    return;
  }

  switch (e.keyCode) {
    case TvKey.Enter:
      if (channels.length > 0) {
        var ch = channels[focusedIndex];
        setParams({ tvFocusedIndex: focusedIndex });
        navigate('tv-player', {
          channelId: ch.id,
          channelTitle: ch.title,
          channelStream: ch.stream
        });
      }
      e.preventDefault(); break;
    case TvKey.Return:
    case TvKey.Backspace:
    case TvKey.Escape:
      goBack(); e.preventDefault(); break;
  }
}
```

**Mount/Unmount:**

```typescript
export var tvPage: Page = {
  mount: function(params: RouteParams) {
    focusedIndex = (typeof params.tvFocusedIndex === 'number') ? params.tvFocusedIndex : 0;
    showSpinnerIn($root);
    getTvChannels().then(
      function(res: any) {
        channels = (res && res.channels) || [];
        if (focusedIndex >= channels.length) focusedIndex = 0;
        render();
      },
      function() {
        $root.html('<div class="watching">' + tplEmptyText({ text: 'Ошибка загрузки' }) + '</div>');
      }
    );
    keys.bind(handleKey);
  },
  unmount: function() {
    keys.unbind();
    clearPage($root);
    channels = [];
  }
};
```

### Этап 2: Плеер каналов

#### 2.1 Вариант A: Переиспользовать существующий player

Существующий `pages/player.ts` уже умеет работать с HLS. Можно передать URL потока как параметр. Однако у него логика для VOD (прогресс, перемотка, выбор качества), которая не нужна для live.

#### 2.2 Вариант B: Отдельный простой ТВ-плеер (рекомендуется)

**Файл:** `src/front/ts/pages/tv-player.ts` (создать)

Упрощённый плеер для live-потоков:

```typescript
import $ from 'jquery';
import { Page, RouteParams } from '../types/app';
import { goBack } from '../router';
import { TvKey } from '../utils/platform';
import { pageKeys, clearPage } from '../utils/page';
import { isProxyEnabled } from '../utils/storage';

var $root = $('#page-tv-player');
var keys = pageKeys();
var hls: any = null;
var video: HTMLVideoElement | null = null;
```

**Шаблон:**
```typescript
function render(title: string): void {
  $root.html(
    '<div class="tv-player">' +
      '<video class="tv-player__video" autoplay></video>' +
      '<div class="tv-player__overlay">' +
        '<div class="tv-player__title">' + title + '</div>' +
      '</div>' +
    '</div>'
  );
  video = $root.find('video')[0] as HTMLVideoElement;
}
```

**Инициализация HLS:**
```typescript
function startPlayback(streamUrl: string): void {
  var url = buildStreamUrl(streamUrl);

  if ((window as any).Hls && (window as any).Hls.isSupported()) {
    hls = new (window as any).Hls({
      // Консервативный конфиг для ТВ (аналогично существующему pages/player/hls.ts)
      maxBufferLength: 30,
      maxMaxBufferLength: 60
    });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on((window as any).Hls.Events.ERROR, function(_: any, data: any) {
      if (data.fatal) {
        if (data.type === (window as any).Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          goBack();
        }
      }
    });
  } else if (video && video.canPlayType('application/vnd.apple.mpegurl')) {
    // Safari / встроенная поддержка HLS
    video!.src = url;
  }
}

function buildStreamUrl(stream: string): string {
  // Аналогично оригиналу — через hls2-fixer или напрямую
  // В нашем проекте можно проще: использовать stream напрямую
  // или через прокси если включен
  return stream;
}
```

**Управление:**
```typescript
function handleKey(e: JQuery.Event): void {
  switch (e.keyCode) {
    case TvKey.Enter:
      // Пауза / воспроизведение
      if (video) {
        if (video.paused) video.play();
        else video.pause();
      }
      e.preventDefault(); break;
    case TvKey.Return:
    case TvKey.Backspace:
    case TvKey.Escape:
    case TvKey.Stop:
      stopPlayback();
      goBack();
      e.preventDefault(); break;
  }
}

function stopPlayback(): void {
  if (hls) { hls.destroy(); hls = null; }
  if (video) { video.pause(); video.src = ''; video = null; }
}
```

**Mount/Unmount:**
```typescript
export var tvPlayerPage: Page = {
  mount: function(params: RouteParams) {
    render(params.channelTitle || '');
    startPlayback(params.channelStream || '');
    keys.bind(handleKey);
  },
  unmount: function() {
    stopPlayback();
    keys.unbind();
    clearPage($root);
  }
};
```

### 3. Регистрация

**Файл:** `src/front/ts/main.ts`

```typescript
import { tvPage } from './pages/tv';
import { tvPlayerPage } from './pages/tv-player';

registerPage('tv', tvPage);
registerPage('tv-player', tvPlayerPage);
```

### 4. HTML-контейнеры

**Файл:** `src/front/index.html`

```html
<div id="page-tv" class="page hidden"></div>
<div id="page-tv-player" class="page hidden"></div>
```

### 5. Навигация из sidebar

**Файл:** `src/front/ts/pages/watching.ts`

Добавить "ТВ" в `MENU_ITEMS` и обработку Enter:
```typescript
var MENU_ITEMS = ['Новинки', 'Я смотрю', 'Закладки', 'ТВ', 'Поиск', 'Настройки', 'Выход'];
```

При Enter на "ТВ":
```typescript
navigate('tv');
```

### 6. CSS

**Файл:** `src/front/css/app.css`

```css
/* Карточка канала */
.card--channel { }
.card__poster--channel {
  background: #1a1a2e;
  display: flex;
  align-items: center;
  justify-content: center;
}
.card__poster--channel img {
  object-fit: contain;  /* логотипы лучше contain, не cover */
  width: 80%;
  height: 80%;
}

/* ТВ-плеер */
.tv-player {
  width: 100%;
  height: 100%;
  position: relative;
  background: #000;
}
.tv-player__video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.tv-player__overlay {
  position: absolute;
  top: 0; left: 0; right: 0;
  padding: 30px 40px;
  background: linear-gradient(to bottom, rgba(0,0,0,0.7), transparent);
  opacity: 0;
  transition: opacity 0.3s;
}
.tv-player:hover .tv-player__overlay,
.tv-player.show-overlay .tv-player__overlay {
  opacity: 1;
}
.tv-player__title {
  font-size: 36px;
  color: #fff;
}
```

---

## Зависимости

- `hls.js` — уже подключен как vendor (`vendor/hls.min.js` в index.html)
- Утилиты `grid`, `page`, `templates` — уже существуют
- Плеер — нужно посмотреть `pages/player/hls.ts` для конфигурации HLS на Tizen

## Объём работ

| Файл | Действие |
|------|----------|
| `types/api.ts` | Изменить (добавить TvChannel, TvChannelsResponse) |
| `types/app.ts` | Изменить (добавить routes) |
| `api/tv.ts` | **Создать** (~10 строк) |
| `pages/tv.ts` | **Создать** (~120-150 строк) |
| `pages/tv-player.ts` | **Создать** (~100-120 строк) |
| `main.ts` | Изменить (import + register) |
| `index.html` | Изменить (добавить 2 div) |
| `pages/watching.ts` | Изменить (пункт меню) |
| `css/app.css` | Изменить (стили ~30 строк) |

## Возможные расширения (не в текущем скоупе)

1. **EPG** — программа передач. API: `/v1/tv/{id}/epg`. Не реализовано в оригинале.
2. **Переключение каналов из плеера** — Ch+/Ch- для переключения без возврата в список.
3. **Избранные каналы** — пометка каналов звездой, отображение в начале списка.
4. **Информационная панель** — overlay с названием текущей передачи (требует EPG).
