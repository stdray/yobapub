# Поиск (Search)

## Описание
Страница поиска с виртуальной клавиатурой для TV-платформ. Пользователь набирает текст через экранную клавиатуру (навигация пультом), результаты отображаются в сетке карточек. Поиск срабатывает автоматически при вводе 3+ символов с debounce 1 сек.

## Анализ оригинала (bundle.from.jsnice.js)

**Ключевые строки:** 53800-54065 (сцена поиска), 51749-52550 (виртуальная клавиатура)

### Архитектура оригинала

**Структура DOM:**
- `.input` — отображение введённого текста
- `.keyboard` — виртуальная клавиатура (сетка кнопок)
- `.results` — сетка результатов поиска
- Переключение фокуса между keyboard и results

**API:**
```
GET /v1/items/search?q={query}&field=title
```
Для быстрого поиска (при наборе, 3+ символов).

```
GET /v1/items/search?q={query}&field={field}&perpage=48&page={page}
```
Для полного поиска с пагинацией (field: title, actor, director).

**Ответ:** `ItemsResponse` — `{ items: Item[], pagination: Pagination }`

**Debounce:** 1000 мс между нажатиями клавиш.

**Виртуальная клавиатура:**
- 3 ряда кириллических букв + цифры
- Backspace, пробел, переключение языка (en/ru)
- Навигация стрелками пульта по кнопкам

---

## План реализации

### 1. Обновить типы маршрутов

**Файл:** `src/front/ts/types/app.ts`

Добавить `'search'` в `RouteName`:
```typescript
export type RouteName = '...' | 'search';
```

Добавить в `RouteParams`:
```typescript
searchQuery?: string;
```

### 2. Создать API-функцию

**Файл:** `src/front/ts/api/items.ts`

```typescript
export function searchItems(query: string, page?: number, perpage?: number): JQueryDeferred<any> {
  var params: Record<string, any> = { q: query, field: 'title' };
  if (page) params.page = page;
  if (perpage) params.perpage = perpage;
  return apiGetWithRefresh('/v1/items/search', params);
}
```

### 3. Создать страницу поиска

**Файл:** `src/front/ts/pages/search.ts`

#### 3.1 Состояние

```typescript
var $root = $('#page-search');
var keys = pageKeys();

var query = '';             // текущий запрос
var results: Item[] = [];   // результаты поиска
var focusedIndex = 0;       // индекс фокуса в результатах
var loading = false;        // флаг загрузки
var noResults = false;      // пустой результат

type FocusArea = 'keyboard' | 'results';
var focusArea: FocusArea = 'keyboard';

// Состояние клавиатуры
var kbRow = 0;
var kbCol = 0;
```

#### 3.2 Раскладка виртуальной клавиатуры

```typescript
var KB_LAYOUTS = {
  ru: [
    ['1','2','3','4','5','6','7','8','9','0'],
    ['й','ц','у','к','е','н','г','ш','щ','з','х','ъ'],
    ['ф','ы','в','а','п','р','о','л','д','ж','э'],
    ['я','ч','с','м','и','т','ь','б','ю','⌫'],
    ['EN','_','⎵','⎵','⎵','⎵','⎵','⎵','OK']
  ],
  en: [
    ['1','2','3','4','5','6','7','8','9','0'],
    ['q','w','e','r','t','y','u','i','o','p'],
    ['a','s','d','f','g','h','j','k','l'],
    ['z','x','c','v','b','n','m','⌫'],
    ['RU','_','⎵','⎵','⎵','⎵','⎵','⎵','OK']
  ]
};

var currentLayout: 'ru' | 'en' = 'ru';
```

**Специальные клавиши:**
- `⌫` — backspace (удалить последний символ)
- `⎵` — пробел (все ячейки `⎵` = одна клавиша "пробел")
- `EN`/`RU` — переключение раскладки
- `OK` — подтвердить / перейти к результатам
- `_` — пробел (одиночный)

#### 3.3 Шаблоны

```typescript
// Шаблон клавиатуры
var tplKeyboard = doT.template(
  '<div class="kb">' +
    '{{~it.rows :row:ri}}' +
      '<div class="kb__row">' +
        '{{~row :key:ci}}' +
          '<div class="kb__key{{?key.focused}} focused{{?}}{{?key.wide}} kb__key--wide{{?}}" ' +
               'data-row="{{=ri}}" data-col="{{=ci}}" data-char="{{=key.char}}">' +
            '{{=key.label}}' +
          '</div>' +
        '{{~}}' +
      '</div>' +
    '{{~}}' +
  '</div>'
);

// Шаблон поля ввода
var tplInput = doT.template(
  '<div class="search-input">' +
    '<span class="search-input__text">{{=it.text}}</span>' +
    '<span class="search-input__cursor">|</span>' +
  '</div>'
);

// Layout
var tplLayout = doT.template(
  '<div class="search">' +
    '{{=it.input}}' +
    '<div class="search__body">' +
      '<div class="search__keyboard">{{=it.keyboard}}</div>' +
      '<div class="search__results">' +
        '<div class="watching__grid">{{=it.results}}</div>' +
      '</div>' +
    '</div>' +
  '</div>'
);
```

#### 3.4 Debounce

```typescript
var searchTimer: any = null;

function scheduleSearch(): void {
  if (searchTimer) clearTimeout(searchTimer);
  if (query.length < 3) {
    results = [];
    noResults = false;
    renderResults();
    return;
  }
  searchTimer = setTimeout(function() {
    doSearch();
  }, 1000);
}

function doSearch(): void {
  loading = true;
  searchItems(query).then(
    function(res: any) {
      loading = false;
      results = (res && res.items) || [];
      noResults = results.length === 0;
      focusedIndex = 0;
      renderResults();
    },
    function() {
      loading = false;
      results = [];
      noResults = true;
      renderResults();
    }
  );
}
```

#### 3.5 Навигация клавишами

**В режиме keyboard:**
- **Left/Right** — перемещение по клавишам в строке
- **Up/Down** — перемещение между строками клавиатуры
- **Enter** — нажать клавишу (добавить символ / backspace / переключить язык / OK → перейти в results)
- **Return/Escape** — goBack()

**В режиме results:**
- **Left/Right/Up/Down** — навигация по сетке карточек через `gridMove`
- **Up** на первом ряду → вернуться к клавиатуре
- **Enter** — открыть movie/serial
- **Return/Escape** — вернуться к клавиатуре

```typescript
function handleKey(e: JQuery.Event): void {
  if (focusArea === 'keyboard') {
    handleKeyboardKey(e);
  } else {
    handleResultsKey(e);
  }
}

function handleKeyboardKey(e: JQuery.Event): void {
  var layout = KB_LAYOUTS[currentLayout];
  var row = layout[kbRow];

  switch (e.keyCode) {
    case TvKey.Left:
      if (kbCol > 0) kbCol--;
      updateKeyboardFocus();
      e.preventDefault(); break;
    case TvKey.Right:
      if (kbCol < row.length - 1) kbCol++;
      updateKeyboardFocus();
      e.preventDefault(); break;
    case TvKey.Up:
      if (kbRow > 0) {
        kbRow--;
        kbCol = Math.min(kbCol, layout[kbRow].length - 1);
      }
      updateKeyboardFocus();
      e.preventDefault(); break;
    case TvKey.Down:
      if (kbRow < layout.length - 1) {
        kbRow++;
        kbCol = Math.min(kbCol, layout[kbRow].length - 1);
      } else if (results.length > 0) {
        focusArea = 'results';
        focusedIndex = 0;
        updateResultsFocus();
      }
      e.preventDefault(); break;
    case TvKey.Enter:
      pressKey(row[kbCol]);
      e.preventDefault(); break;
    case TvKey.Return:
    case TvKey.Backspace:
    case TvKey.Escape:
      goBack(); e.preventDefault(); break;
  }
}

function pressKey(char: string): void {
  if (char === '⌫') {
    query = query.slice(0, -1);
  } else if (char === '⎵' || char === '_') {
    query += ' ';
  } else if (char === 'EN') {
    currentLayout = 'en';
    renderKeyboard();
    return;
  } else if (char === 'RU') {
    currentLayout = 'ru';
    renderKeyboard();
    return;
  } else if (char === 'OK') {
    if (results.length > 0) {
      focusArea = 'results';
      focusedIndex = 0;
      updateResultsFocus();
    }
    return;
  } else {
    query += char;
  }
  renderInput();
  scheduleSearch();
}
```

#### 3.6 Экспорт

```typescript
export var searchPage: Page = {
  mount: function(params: RouteParams) {
    query = params.searchQuery || '';
    results = [];
    focusedIndex = 0;
    focusArea = 'keyboard';
    kbRow = 0;
    kbCol = 0;
    currentLayout = 'ru';
    render();
    keys.bind(handleKey);
    if (query.length >= 3) doSearch();
  },
  unmount: function() {
    if (searchTimer) clearTimeout(searchTimer);
    keys.unbind();
    clearPage($root);
    results = [];
  }
};
```

### 4. Зарегистрировать страницу

**Файл:** `src/front/ts/main.ts`

```typescript
import { searchPage } from './pages/search';
registerPage('search', searchPage);
```

### 5. HTML-контейнер

**Файл:** `src/front/index.html`

```html
<div id="page-search" class="page hidden"></div>
```

### 6. Навигация из sidebar

**Файл:** `src/front/ts/pages/watching.ts`

Пункт "Поиск" уже есть в `MENU_ITEMS` (индекс 2). Добавить обработку Enter:
```typescript
else if (menuIndex === 2) { navigate('search'); }
```

(Проверить текущие индексы — возможно, после добавления "Новинки" индексы сдвинутся.)

### 7. CSS

**Файл:** `src/front/css/app.css`

Новые стили для клавиатуры и поля ввода:

```css
/* Поиск */
.search { padding: 40px; }

.search-input {
  font-size: 36px;
  padding: 16px 24px;
  background: rgba(255,255,255,0.1);
  border-radius: 8px;
  margin-bottom: 30px;
  min-height: 60px;
}
.search-input__cursor {
  animation: blink 1s step-end infinite;
}
@keyframes blink { 50% { opacity: 0; } }

.search__body { display: flex; gap: 40px; }
.search__keyboard { flex: 0 0 auto; }
.search__results { flex: 1; overflow-y: auto; max-height: 800px; }

/* Клавиатура */
.kb__row { display: flex; gap: 6px; margin-bottom: 6px; }
.kb__key {
  width: 64px; height: 64px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.1);
  border-radius: 8px;
  font-size: 28px;
  color: #fff;
}
.kb__key.focused {
  background: #e50914;
  transform: scale(1.1);
}
.kb__key--wide { width: 140px; }
```

---

## Зависимости

- `api/items.ts` — нужна функция `searchItems`
- Все утилиты (`grid`, `page`, `templates`) — уже существуют
- Типы `Item`, `ItemsResponse` — уже определены

## Объём работ

| Файл | Действие |
|------|----------|
| `types/app.ts` | Изменить (добавить route) |
| `api/items.ts` | Изменить (добавить searchItems) |
| `pages/search.ts` | **Создать** (~250-300 строк) |
| `main.ts` | Изменить (import + register) |
| `index.html` | Изменить (добавить div) |
| `pages/watching.ts` | Изменить (обработка пункта "Поиск") |
| `css/app.css` | Изменить (стили клавиатуры ~40 строк) |

## Сложности и нюансы

1. **Виртуальная клавиатура** — основная сложность. Нужна корректная навигация между строками разной длины (кириллица: 12/11/10 букв в рядах).
2. **Debounce** — стандартный setTimeout, но важно отменять при unmount.
3. **Переключение фокуса** keyboard ↔ results — плавный переход при Down с последней строки клавиатуры и Up с первого ряда результатов.
4. **ES5 совместимость** — нельзя использовать arrow functions, let/const, template literals (SWC транспилирует, но лучше писать в стиле проекта).
