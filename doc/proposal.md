# Предложения по улучшению (Android APK)

## Сводная таблица (отсортировано по Влияние/Сложность)

| Приоритет | # | Что сделать | Влияние | Сложность | Ratio | Статус |
|:---------:|:-:|-------------|:-------:|:---------:|:-----:|--------|
| — | 10 | Back из плеера: `keydown(8)` в WebView | 5 | 2 | 2.50 | **DONE** |
| 1 | 4 | Убрать лишний `fetchRewrittenHls` при `selectedAudio===0` | 3 | 1 | 3.00 | **DONE** |
| 2 | 1 | Scale один раз в `onCreate` через `DisplayMetrics` | 2 | 1 | 2.00 | **DONE** |
| 3 | 6 | `preload="auto"` на `<video>` | 2 | 1 | 2.00 | **DONE** |
| 4 | 2 | Параллельные `getItem` + `media-links` | 4 | 2 | 2.00 | **DONE** |
| 5 | 7 | `http` стриминг по умолчанию на Android | 4 | 2 | 2.00 | **DONE** |
| 6 | 5 | Нативный HLS вместо hls.js на Android | 5 | 3 | 1.67 | **DONE** |
| 7 | 3 | ~~Кеш `media-links` в `sessionStorage`~~ | 3 | 2 | 1.50 | ~~SKIP~~ |
| 8 | 11 | `fetchRewrittenHls` на бекенд | 4 | 3 | 1.33 | **DONE** |
| 9 | 9 | ~~Офлайн-страница~~ | 2 | 2 | 1.00 | ~~SKIP~~ |
| 10 | 8 | Overlay Play иконка | 1 | 2 | 0.50 | TODO |

---

## Детальный план реализации

### Приоритет 1 — #4: Убрать лишний `fetchRewrittenHls` при `selectedAudio === 0`

**Проблема:** В `startWithAudio()` при `selectedAudio > 0` вызывается `fetchRewrittenHls` — это HTTP-запрос к CDN за m3u8-манифестом, его парсинг и перезапись URL аудиодорожки. Нужно убедиться, что при `selectedAudio === 0` (дефолтная дорожка) этот вызов точно не происходит ни в одном code path.

**Файлы:** `src/front/ts/pages/player.ts`

**Что делать:**
1. Аудит всех вызовов `fetchRewrittenHls` — их два: `startWithAudio()` и `switchToRewrittenHls()` (через `applyAudioSwitch`).
2. В `startWithAudio()` условие `selectedAudio > 0 && currentAudios.length > 1` — корректно, при `selectedAudio === 0` fetchRewrittenHls не вызывается.
3. В `applyAudioSwitch()` — вызывается при любом `idx`, включая 0. **Баг:** если пользователь из панели выберет дорожку 0, вызовется `switchToRewrittenHls` с `audioIndex = currentAudios[0].index`. Нужно добавить проверку: если `idx === 0`, использовать прямой URL без rewrite.

**Код:**
```typescript
// applyAudioSwitch: добавить ранний выход для дефолтной дорожки
function applyAudioSwitch(idx: number): void {
  selectedAudio = idx;
  if (idx === 0 || currentAudios.length <= 1) {
    // Дефолтная дорожка — переключить на прямой URL без HLS rewrite
    var pos = videoEl ? videoEl.currentTime : 0;
    var paused = videoEl ? videoEl.paused : false;
    if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
    currentHlsUrl = '';
    resumeTime = pos;
    resumePaused = paused;
    qualitySwitching = true;
    var url = getUrlFromFile(currentFiles[selectedQuality]);
    if (url) playSource(url);
    return;
  }
  var f = currentFiles[selectedQuality];
  var hlsUrl = (f.urls && f.urls.hls2) || (f.url && f.url.hls2) || '';
  if (hlsUrl) {
    if (isProxyAll()) hlsUrl = proxyUrl(hlsUrl);
    switchToRewrittenHls(hlsUrl, idx);
    return;
  }
  showToast('Смена аудио недоступна');
}
```

**Эффект:** Убирает лишний HTTP round-trip + JS-парсинг при возврате на дефолтную дорожку.

---

### Приоритет 2 — #1: Scale один раз в `onCreate`

**Проблема:** `addOnLayoutChangeListener` пересчитывает `setInitialScale` при каждом layout change, включая начало/конец воспроизведения видео, показ/скрытие панели и т.д. Это может вызывать мерцание.

**Файл:** `src/apk/app/src/main/java/su/p3o/yobapub/WebViewActivity.java`

**Что делать:**
```java
// Удалить весь блок addOnLayoutChangeListener и заменить на:
android.util.DisplayMetrics dm = new android.util.DisplayMetrics();
getWindowManager().getDefaultDisplay().getMetrics(dm);
int scale = (int) Math.round(dm.widthPixels * 100.0 / 1920);
webView.setInitialScale(scale);
```

**Эффект:** Scale вычисляется один раз. Убирает лишние пересчёты при каждом layout event.

---

### Приоритет 3 — #6: `preload="auto"` на `<video>`

**Проблема:** Элемент `<video>` создаётся без атрибута `preload`, браузер по умолчанию может использовать `metadata` или не предзагружать вовсе.

**Файл:** `src/front/ts/pages/player/template.ts`

**Что делать:**
1. Проверить шаблон `tplPlayer()` — найти `<video>` тег.
2. Добавить `preload="auto"` к элементу.

**Код:** В шаблоне `<video>` добавить атрибут:
```html
<video preload="auto"></video>
```

**Эффект:** Браузер начнёт буферизацию сразу при установке `src`, до вызова `play()`.

---

### Приоритет 4 — #2: Параллельные `getItem` + `media-links`

**Проблема:** В `playerPage.mount()` сначала вызывается `getItem(id)`, ждётся ответ, потом из него извлекается `media.mid` и вызывается `loadMediaLinks(mid)`. Два последовательных HTTP-запроса.

**Файлы:** `src/front/ts/pages/player.ts`, `src/front/ts/pages/player/media.ts`

**Что делать:**

Проблема в том, что `mid` (media ID) получается из ответа `getItem` — это ID эпизода/видео. Но `mid` мы уже знаем на момент навигации! Страницы `serial.ts` и `movie.ts` имеют эти ID при формировании `navigate('player', ...)`.

**Вариант A — передать mid через RouteParams:**
1. В `serial.ts`/`movie.ts` при вызове `navigate('player', ...)` добавить `mid` в параметры.
2. В `player.ts mount()` запускать `getItem(id)` и `loadMediaLinks(params.mid!)` параллельно через `$.when()`.
3. Когда оба завершатся — продолжать как сейчас.

**Вариант B — предзапрос media-links с предположением mid:**
Менее надёжно, если mid всегда совпадает с episode.id.

**Код (вариант A):**
```typescript
// serial.ts / movie.ts — при navigate добавить mid
navigate('player', { id: item.id, season: s, episode: ep, mid: episode.id });

// player.ts mount() — параллельный запрос
var mid = params.mid;
if (mid) {
  $.when(getItem(id), loadMediaLinksAsync(mid)).then(
    function(itemRes, mediaRes) {
      // использовать оба результата
    }
  );
} else {
  // fallback: последовательная загрузка как сейчас
}
```

Для этого `loadMediaLinks` нужно сделать возвращающей Deferred (сейчас callback-based).

**Эффект:** Вместо ~400-800ms (два запроса по 200-400ms) — ~200-400ms (один параллельный round-trip). Самый значительный выигрыш для скорости запуска видео.

---

### Приоритет 5 — #7: `http` стриминг по умолчанию на Android

**Проблема:** Сейчас `getStreamingType()` возвращает `hls4` по умолчанию. HLS требует скачивания манифеста → парсинг → скачивание первого сегмента. Прямой HTTP URL (`mp4`) — один запрос с Range-header и сразу воспроизведение.

**Файлы:** `src/front/ts/utils/storage.ts`, `src/front/ts/utils/platform.ts`, `src/front/ts/main.ts`

**Что делать:**
1. Добавить детекцию Android WebView в `platform.ts`:
   ```typescript
   export function isAndroidWebView(): boolean {
     return /Android.*wv/.test(navigator.userAgent) || 
            typeof (window as any).NativeApp !== 'undefined';
   }
   ```
2. В `main.ts` при инициализации, если Android WebView и нет сохранённого пользовательского выбора:
   ```typescript
   if (isAndroidWebView() && !localStorage.getItem('kp_streaming_type')) {
     setStreamingType('http');
   }
   ```
3. В настройках (`settings.ts`) дать возможность переключить обратно на HLS.

**Эффект:** Прямой mp4 вместо HLS — старт видео на 1-3 секунды быстрее. HLS всё ещё доступен для смены аудио через панель.

**Ограничение:** При `http` смена аудиодорожки невозможна (нет HLS манифеста для rewrite). Нужно показать toast "Смена аудио доступна только в режиме HLS" или автоматически переключиться на HLS при выборе аудио.

---

### Приоритет 6 — #5: Нативный HLS вместо hls.js на Android

**Проблема:** hls.js работает через MSE (Media Source Extensions) — JS парсит m3u8 манифест, скачивает .ts сегменты, демуксит и передаёт в `<video>` через `SourceBuffer`. Android WebView поддерживает нативный HLS — `<video src="url.m3u8">` и всё делает нативно.

**Файл:** `src/front/ts/pages/player.ts` (функция `playSource`)

**Что делать:**
1. В `playSource()` при определении использовать ли hls.js, добавить проверку платформы:
   ```typescript
   // Если Android WebView и видео с .m3u8 URL — не использовать hls.js
   if (isAndroidWebView()) {
     // Нативный HLS: просто videoEl.src = url
     videoEl.src = url;
     videoEl.addEventListener('loadedmetadata', onMeta);
     return;
   }
   ```
2. При нативном HLS аудиодорожки и субтитры из манифеста управляются через `videoEl.audioTracks` и `videoEl.textTracks` нативно.
3. Для `blob:` URL (rewritten HLS) всё ещё использовать hls.js (blob URL не поддерживаются нативно).

**Эффект:** Нативный парсинг и буферизация — быстрее, меньше CPU, меньше памяти. Основной выигрыш на слабых TV/приставках.

**Риски:**
- Нативный HLS в WebView может не поддерживать все фичи hls.js (ABR, retry, аудиотреки).
- Нужно тестировать на конкретном устройстве.
- `videoEl.audioTracks` может быть undefined в некоторых WebView — fallback на hls.js.

---

### Приоритет 7 — #3: Кеш `media-links` в `sessionStorage`

**Проблема:** При переключении серий `loadMediaLinks(mid)` вызывается заново. Если пользователь вернулся к уже просмотренному эпизоду — лишний HTTP-запрос.

**Файл:** `src/front/ts/pages/player/media.ts`

**Что делать:**
```typescript
var CACHE_KEY_PREFIX = 'ml_';
var CACHE_TTL = 30 * 60 * 1000; // 30 минут

export function loadMediaLinks(mid: number, cb: (files: VideoFile[], subs: Subtitle[]) => void): void {
  var cacheKey = CACHE_KEY_PREFIX + mid;
  var cached = sessionStorage.getItem(cacheKey);
  if (cached) {
    try {
      var parsed = JSON.parse(cached);
      if (Date.now() - parsed.ts < CACHE_TTL) {
        cb(parsed.files, parsed.subs);
        return;
      }
    } catch(e) {}
  }
  
  apiGet('/v1/items/media-links', { mid: mid }).then(
    function(res: any) {
      var data = Array.isArray(res) ? res[0] : res;
      var files = (data && data.files) || [];
      var subs = (data && data.subtitles) || [];
      sessionStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), files: files, subs: subs }));
      cb(files, subs);
    },
    function() { cb([], []); }
  );
}
```

**Эффект:** Мгновенный старт при возврате к уже загруженному эпизоду. Экономия трафика. TTL 30 минут достаточен — ссылки CDN обычно валидны дольше.

---

### Приоритет 8 — #11: `fetchRewrittenHls` на бекенд

**Проблема:** Клиент сам скачивает m3u8 с CDN, парсит, переписывает аудиодорожку, создаёт blob URL. На слабых устройствах JS-парсинг медленный, плюс дополнительный round-trip клиент→CDN.

**Что делать:**
1. На бекенде добавить endpoint (например `GET /v1/hls/rewrite?url=...&audio=N`).
2. Сервер скачивает m3u8, переписывает, отдаёт готовый манифест с абсолютными URL.
3. На клиенте: вместо `fetchRewrittenHls(hlsUrl, audioIndex, cb)` → `videoEl.src = backendRewriteUrl`.

**Код (клиент):**
```typescript
function getRewrittenHlsUrl(hlsUrl: string, audioIndex: number): string {
  return getApiBase() + '/v1/hls/rewrite?url=' + encodeURIComponent(hlsUrl) 
    + '&audio=' + audioIndex + '&access_token=' + getAccessToken();
}
```

**Эффект:** Убирает JS-парсинг + клиентский round-trip к CDN. Сервер ближе к CDN (или может кешировать). Особенно выгодно при медленном WiFi.

---

### Приоритет 9 — #9: Офлайн-страница

**Файл:** `src/apk/app/src/main/java/su/p3o/yobapub/WebViewActivity.java`

**Что делать:**
1. В `WebViewClient` переопределить `onReceivedError()`:
   ```java
   @Override
   public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
     view.loadData("<html><body style='background:#1a1a1a;color:#fff;display:flex;align-items:center;"
       + "justify-content:center;height:100vh;font-family:sans-serif;'>"
       + "<div><h1>Нет подключения</h1><p>" + description + "</p></div>"
       + "</body></html>", "text/html", "UTF-8");
   }
   ```
2. По нажатию Enter/OK перезагружать `webView.loadUrl(BuildConfig.APP_URL)`.

**Эффект:** Понятное сообщение вместо стандартной ошибки Android WebView.

---

### Приоритет 10 — #8: Overlay Play иконка

**Проблема:** Android показывает системный play overlay при autoplay без user gesture. Убирается через ~1 сек сам.

**Решение:** Низкий приоритет. Можно убрать установив `setMediaPlaybackRequiresUserGesture(true)` и управляя play через JS — но это потребует рефакторинга потока запуска видео. Не стоит трогать пока не будут сделаны более важные пункты.

---

## Рекомендуемый порядок реализации (спринт)

**Фаза 1 — Quick wins (влияние при минимуме кода):**
- #4 → #1 → #6 — три простых правки, каждая занимает 5-10 минут

**Фаза 2 — Ускорение запуска видео:**
- #2 (параллельные запросы) — основной выигрыш по скорости
- #7 (http по умолчанию на Android) — убирает HLS overhead для 90% случаев

**Фаза 3 — Глубокая оптимизация:**
- #5 (нативный HLS) — требует тестирования на устройстве
- ~~#3 (кеш media-links) — полезно для сериалов~~

**Фаза 4 — Бекенд + UX:**
- #11 (rewrite на бекенде) — требует доработки серверной части
- ~~#9 (офлайн) — приятный UX-штрих~~
