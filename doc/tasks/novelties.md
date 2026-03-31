# Новинки (New Releases)

## Описание
Страница "Новинки" отображает последние добавленные материалы по категориям: фильмы, сериалы, документальные фильмы, документальные сериалы, 3D, ТВ-шоу, концерты. Каждая категория — горизонтальная секция с карточками. Навигация через боковое меню (sidebar), которое уже есть на странице `watching`.

## Анализ оригинала (bundle.from.jsnice.js)

**Ключевые строки:** 44864-44945

Оригинал загружает 7 параллельных запросов к `/v1/items` с разными `type` и `sort=created-` (по дате добавления, убывание). Результат — массив секций, каждая с заголовком и карточками (id, posterUrl, title). Отображение — 6-колоночная сетка (у нас — 4, `CARDS_PER_ROW`).

**API-вызовы:**
```
GET /v1/items?type=movie&sort=created-
GET /v1/items?type=serial&sort=created-
GET /v1/items?type=documovie&sort=created-
GET /v1/items?type=docuserial&sort=created-
GET /v1/items?type=3D&sort=created-
GET /v1/items?type=tvshow&sort=created-
GET /v1/items?type=concert&sort=created-
```

**Ответ:** `ItemsResponse` (уже определен в `types/api.ts`) — `{ items: Item[], pagination: Pagination }`.

Пагинации на странице нет — загружается только первая страница каждого типа (по умолчанию API возвращает ~20 элементов).

---

## План реализации

### 1. Обновить типы маршрутов

**Файл:** `src/front/ts/types/app.ts`

Добавить `'novelties'` в `RouteName`:
```typescript
export type RouteName = 'login' | 'watching' | 'bookmarks' | 'movie' | 'serial' | 'player' | 'settings' | 'novelties';
```

Добавить в `RouteParams` (если понадобится для восстановления фокуса при возврате):
```typescript
export interface RouteParams {
  // ... existing
  noveltiesSectionIndex?: number;
  noveltiesItemIndex?: number;
}
```

### 2. Создать API-модуль

**Файл:** `src/front/ts/api/items.ts` (уже существует, дополнить)

Добавить функцию:
```typescript
import { apiGetWithRefresh } from './client';

export function getItems(type: string, sort?: string, page?: number): JQueryDeferred<any> {
  var params: Record<string, any> = { type: type };
  if (sort) params.sort = sort;
  if (page) params.page = page;
  return apiGetWithRefresh('/v1/items', params);
}
```

Проверить, есть ли уже такая функция в `api/items.ts`. Если нет — добавить.

### 3. Создать страницу

**Файл:** `src/front/ts/pages/novelties.ts`

Структура (по образцу `watching.ts`):

```typescript
import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { navigate, setParams } from '../router';
import { TvKey } from '../utils/platform';
import { CARDS_PER_ROW } from '../settings';
import { pageKeys, showSpinnerIn, clearPage, scrollIntoView } from '../utils/page';
import { gridMove, gridPos } from '../utils/grid';
import { tplCard, tplEmptyText } from '../utils/templates';
import { proxyUrl } from '../utils/storage';
import { getItems } from '../api/items';

var $root = $('#page-novelties');
var keys = pageKeys();
```

#### 3.1 Данные и состояние

```typescript
var SECTIONS_CONFIG = [
  { type: 'movie',      title: 'Новые фильмы' },
  { type: 'serial',     title: 'Новые сериалы' },
  { type: 'documovie',  title: 'Новые документальные фильмы' },
  { type: 'docuserial', title: 'Новые документальные сериалы' },
  { type: '3D',         title: 'Новое в 3D' },
  { type: 'tvshow',     title: 'Новые ТВ-шоу' },
  { type: 'concert',    title: 'Новые концерты' }
];

interface SectionData {
  title: string;
  items: Array<{ id: number; type: string }>;
}

var sections: SectionData[] = [];
var allItems: Item[][] = [];  // полные Item для каждой секции, для постеров
var focusedSection = 0;
var focusedIndex = 0;
```

#### 3.2 Загрузка данных

При mount — 7 параллельных запросов через `$.when()`:
```typescript
var requests = [];
for (var i = 0; i < SECTIONS_CONFIG.length; i++) {
  requests.push(getItems(SECTIONS_CONFIG[i].type, 'created-'));
}
$.when.apply($, requests).then(function() {
  // arguments[i][0] или arguments[i] — в зависимости от количества
  sections = [];
  allItems = [];
  for (var i = 0; i < SECTIONS_CONFIG.length; i++) {
    var res = arguments.length === SECTIONS_CONFIG.length
      ? (Array.isArray(arguments[i]) ? arguments[i][0] : arguments[i])
      : arguments[i];
    var items = (res && res.items) || [];
    if (items.length > 0) {
      sections.push({
        title: SECTIONS_CONFIG[i].title,
        items: items.map(function(it: Item) { return { id: it.id, type: it.type }; })
      });
      allItems.push(items);
    }
  }
  render();
});
```

#### 3.3 Шаблоны

Переиспользовать `tplCard`, `tplEmptyText` из `utils/templates.ts`.

Добавить шаблон layout (аналогично `watching.ts`):
```typescript
var tplSection = doT.template(
  '<div class="watching__section-title">{{=it.title}}</div>' +
  '<div class="watching__grid" data-section="{{=it.idx}}">{{=it.cards}}</div>'
);
```

#### 3.4 Навигация клавишами

Полностью аналогично `watching.ts` — `handleContentKey`:
- **Left/Right/Up/Down** — перемещение по сетке карточек через `gridMove`, переход между секциями по вертикали
- **Enter** — открыть `movie` или `serial` в зависимости от `item.type`
- **Return/Backspace/Escape** — `goBack()`

Боковое меню НЕ нужно на этой странице (вызывается из watching sidebar).

#### 3.5 Экспорт

```typescript
export var noveltiesPage: Page = {
  mount: function(params: RouteParams) { ... },
  unmount: function() { keys.unbind(); clearPage($root); sections = []; allItems = []; }
};
```

### 4. Зарегистрировать страницу

**Файл:** `src/front/ts/main.ts`

```typescript
import { noveltiesPage } from './pages/novelties';
// ...
registerPage('novelties', noveltiesPage);
```

### 5. Добавить HTML-контейнер

**Файл:** `src/front/index.html`

Добавить внутри `#app`:
```html
<div id="page-novelties" class="page hidden"></div>
```

### 6. Добавить пункт в sidebar на watching

**Файл:** `src/front/ts/pages/watching.ts`

В массиве `MENU_ITEMS` добавить "Новинки" (первым пунктом или вторым, по аналогии с оригиналом):
```typescript
var MENU_ITEMS = ['Новинки', 'Я смотрю', 'Закладки', 'Поиск', 'Настройки', 'Выход'];
```

Обновить `handleMenuKey` — при Enter на "Новинки":
```typescript
if (menuIndex === 0) { navigate('novelties'); }
```

Сдвинуть индексы остальных пунктов.

### 7. CSS (при необходимости)

**Файл:** `src/front/css/app.css`

Страница использует те же классы: `.watching`, `.watching__section-title`, `.watching__grid`, `.card`. Дополнительный CSS не нужен, если визуально всё аналогично watching.

---

## Зависимости

- `api/items.ts` — вероятно, уже есть функция для получения item по id, нужно добавить `getItems` для списка
- Все утилиты (`grid`, `page`, `templates`, `storage`) — уже существуют
- Типы `Item`, `ItemsResponse` — уже определены в `types/api.ts`

## Объём работ

| Файл | Действие |
|------|----------|
| `types/app.ts` | Изменить (добавить route) |
| `api/items.ts` | Изменить (добавить getItems) |
| `pages/novelties.ts` | **Создать** (~150-180 строк) |
| `main.ts` | Изменить (import + register) |
| `index.html` | Изменить (добавить div) |
| `pages/watching.ts` | Изменить (пункт меню + навигация) |
