# История просмотров (Watch History)

## Описание
Страница "История просмотров" отображает хронологический список всего просмотренного контента с пагинацией. Каждая запись показывает карточку (постер + название), дату последнего просмотра и прогресс. Навигация через боковое меню (sidebar) на странице `watching` — новый пункт "История".

## Анализ оригинала (bundle.from.jsnice.js)

В оригинальном клиенте отдельной страницы "История" **нет** — реализуем как новую функциональность на основе API.

## API

### Получение истории
```
GET /v1/history?page={page}&perpage={perpage}
```

**Параметры:**
- `page` (int, optional) — номер страницы
- `perpage` (int, optional) — элементов на странице, по умолчанию 20, макс 50

**Ответ:**
```json
{
  "history": [
    {
      "time": 1234,
      "counter": 3,
      "first_seen": 1711900000,
      "last_seen": 1711986400,
      "item": { "id": 1, "title": "...", "type": "movie", "posters": { "small": "...", "medium": "...", "big": "..." }, ... },
      "media": { ... }
    }
  ],
  "pagination": {
    "total": 5,
    "current": 1,
    "perpage": 20,
    "total_items": 100
  }
}
```

**Поля записи:**
- `time` — позиция остановки просмотра (секунды)
- `counter` — сколько раз смотрели этот media
- `first_seen` — Unix timestamp первого просмотра
- `last_seen` — Unix timestamp последнего просмотра
- `item` — объект Item (id, title, type, posters и т.д.)
- `media` — объект media (видео/эпизод)

### Очистка истории
```
POST /v1/history/clear-for-media?id={media_id}
POST /v1/history/clear-for-season?id={season_id}
POST /v1/history/clear-for-item?id={item_id}
```

Очистка — **не в первой итерации**, можно добавить позже.

---

## План реализации

### 1. Добавить типы API

**Файл:** `src/front/ts/types/api.ts`

Добавить интерфейсы:
```typescript
export interface HistoryEntry {
  readonly time: number;
  readonly counter: number;
  readonly first_seen: number;
  readonly last_seen: number;
  readonly item: Item;
  readonly media: HistoryMedia;
}

export interface HistoryMedia {
  readonly id: number;
  readonly title: string;
  readonly number: number;
  readonly duration: number;
  readonly thumbnail?: string;
}

export interface HistoryResponse {
  readonly history: HistoryEntry[];
  readonly pagination: Pagination;
}
```

> Точная структура `media` не задокументирована — потребуется проверить реальный ответ API и уточнить поля.

### 2. Создать API-функцию

**Файл:** `src/front/ts/api/history.ts` (новый)

```typescript
import { apiGetWithRefresh } from './client';
import { HistoryResponse } from '../types/api';

export function getHistory(page?: number): JQuery.Deferred<HistoryResponse> {
  const params: Record<string, number> = { perpage: 20 };
  if (page) params.page = page;
  return apiGetWithRefresh('/v1/history', params);
}
```

### 3. Обновить типы маршрутов

**Файл:** `src/front/ts/types/app.ts`

Добавить `'history'` в `RouteName`:
```typescript
export type RouteName = '...' | 'history';
```

Добавить в `RouteParams`:
```typescript
historyPage?: number;
historyFocusedIndex?: number;
```

### 4. Создать страницу

**Файл:** `src/front/ts/pages/history.ts` (новый, ~150-200 строк)

#### 4.1 Состояние
```typescript
var $root = $('#page-history');
var keys = pageKeys();

var entries: HistoryEntry[] = [];
var focusedIndex = 0;
var currentPage = 1;
var totalPages = 1;
var loading = false;
```

#### 4.2 Загрузка данных

При mount — загрузка первой страницы:
```typescript
function loadPage(page: number): void {
  loading = true;
  showSpinnerIn($root);
  getHistory(page).then(function(res) {
    entries = res.history;
    currentPage = res.pagination.current;
    totalPages = res.pagination.total;
    loading = false;
    render();
  });
}
```

#### 4.3 Шаблоны

Переиспользовать `tplCard` из `utils/templates.ts` для карточек. Каждая карточка — постер из `entry.item.posters.medium` и название `entry.item.title`.

Дополнительно показать под карточкой:
- Дату последнего просмотра (`last_seen` → форматированная дата)
- Прогресс просмотра (если `time > 0` и `media.duration > 0`)

Шаблон layout:
```typescript
var tplLayout = doT.template(
  '<div class="history">' +
    '<div class="history__title">История просмотров</div>' +
    '<div class="watching__grid">{{=it.cards}}</div>' +
    '<div class="history__pager">{{=it.pager}}</div>' +
  '</div>'
);
```

Шаблон пагинатора — показать "Страница X из Y", навигация Left/Right на последнем ряду для переключения страниц.

#### 4.4 Навигация клавишами

- **Left/Right/Up/Down** — перемещение по сетке карточек через `gridMove`
- **Enter** — открыть `movie` или `serial` в зависимости от `entry.item.type`
- **Channel Down / стрелка вниз за пределами сетки** — следующая страница
- **Channel Up / стрелка вверх за пределами сетки** — предыдущая страница
- **Return/Backspace/Escape** — `goBack()`

#### 4.5 Экспорт

```typescript
export var historyPage: Page = {
  mount: function(params: RouteParams) {
    currentPage = params.historyPage || 1;
    focusedIndex = params.historyFocusedIndex || 0;
    loadPage(currentPage);
    keys.bind(handleKey);
  },
  unmount: function() {
    keys.unbind();
    clearPage($root);
    entries = [];
  }
};
```

### 5. Зарегистрировать страницу

**Файл:** `src/front/ts/main.ts`

```typescript
import { historyPage } from './pages/history';
registerPage('history', historyPage);
```

### 6. Добавить HTML-контейнер

**Файл:** `src/front/index.html`

```html
<div id="page-history" class="page hidden"></div>
```

### 7. Добавить пункт в sidebar

**Файл:** `src/front/ts/pages/watching.ts`

В массив `MENU_ITEMS` добавить "История" после "Я смотрю":
```typescript
var MENU_ITEMS = ['Новинки', 'Я смотрю', 'История', 'Закладки', 'ТВ', 'Поиск', 'Настройки', 'Выход'];
```

Обновить `handleMenuKey` — добавить обработку Enter для нового пункта и сдвинуть индексы:
```typescript
// menuIndex === 0 → navigate('novelties')
// menuIndex === 2 → navigate('history')     ← НОВОЕ
// menuIndex === 3 → navigate('bookmarks')   ← был 2
// menuIndex === 4 → navigate('tv')          ← был 3
// menuIndex === 5 → navigate('search')      ← был 4
// menuIndex === 6 → navigate('settings')    ← был 5
// menuIndex === 7 → выход                   ← был 6
```

### 8. CSS (минимально)

**Файл:** `src/front/css/app.css`

```css
.history__title {
  font-size: 36px;
  padding: 20px 40px 10px;
}
.history__pager {
  text-align: center;
  padding: 20px;
  font-size: 24px;
  color: rgba(255,255,255,0.6);
}
```

Карточки используют существующие классы `.watching__grid` и `.card`.

### 9. Форматирование даты

Добавить утилиту в `utils/format.ts` (или inline):
```typescript
export function formatDate(unixTimestamp: number): string {
  const d = new Date(unixTimestamp * 1000);
  const day = d.getDate();
  const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  return day + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
}
```

---

## Зависимости

- `api/client.ts` — `apiGetWithRefresh` уже существует
- Все утилиты (`grid`, `page`, `templates`, `storage`) — уже существуют
- Типы `Item`, `Poster`, `Pagination` — уже определены в `types/api.ts`

## Объём работ

| Файл | Действие |
|------|----------|
| `types/api.ts` | Изменить (добавить HistoryEntry, HistoryMedia, HistoryResponse) |
| `api/history.ts` | **Создать** (~15 строк) |
| `types/app.ts` | Изменить (добавить route + params) |
| `pages/history.ts` | **Создать** (~150-200 строк) |
| `main.ts` | Изменить (import + register) |
| `index.html` | Изменить (добавить div) |
| `pages/watching.ts` | Изменить (пункт меню + индексы) |
| `css/app.css` | Изменить (стили ~10 строк) |

## Нюансы

1. **Структура `media`** — API-документация не детализирует поля `media`. Нужно сделать реальный запрос к API и уточнить интерфейс `HistoryMedia`.
2. **Пагинация** — первая страница в проекте с пагинацией. Навигация: стрелками за пределами последнего ряда карточек или отдельными кнопками ◀ ▶ внизу.
3. **Дата** — `last_seen` — Unix timestamp, нужно форматировать в читаемую дату на русском.
4. **Сортировка** — API возвращает историю отсортированную по `last_seen` убыванию (предположительно). Проверить при интеграции.
