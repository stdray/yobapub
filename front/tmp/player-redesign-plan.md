# План переделки плеера yobapub под стиль KinoPub STV

Цель: визуально и функционально приблизить плеер к KinoPub STV, сохраняя текущий стек (jQuery + doT + hls.js), без внешних зависимостей.

Файлы для изменения: `src/ts/pages/player.ts`, `src/css/app.css`.


## Этап 1. Новый layout overlay (верх экрана)

Сейчас: заголовок, прогресс-бар и кнопки собраны в одном блоке `player__overlay` внизу.

Сделать: заголовок и эпизод вынести наверх, как в KPSTV.

### Шаблон

Заменить `tplPlayer` на:

```
<div class="player">
  <video></video>
  <div class="player__spinner"><div class="spinner__circle"></div></div>
  <div class="player__info hidden"></div>
  <div class="player__osd hidden"></div>           ← NEW: иконка play/pause/rw/ff по центру
  <div class="player__gradient hidden"></div>       ← NEW: градиент сверху
  <div class="player__header hidden">               ← NEW: заголовок сверху
    <div class="player__title">{{=it.title}}</div>
    <div class="player__episode">{{=it.episode}}</div>
  </div>
  <div class="player__bar hidden">                  ← ПЕРЕРАБОТАН: прогресс-бар снизу
    <div class="player__bar-wrap">
      <div class="player__bar-progress">
        <div class="player__bar-value">
          <div class="player__bar-dot">
            <div class="player__bar-seek"></div>
          </div>
        </div>
      </div>
      <div class="player__bar-duration"></div>
    </div>
    <div class="player__bar-stream"></div>
  </div>
  <div class="player__panel hidden"></div>           ← ПЕРЕРАБОТАН: панель audio/subs/quality
  <div class="player__toast hidden"></div>
</div>
```

### CSS

```css
/* Градиент сверху (как KPSTV) */
.player__gradient {
  position: absolute; top: 0; left: 0; width: 100%;
  height: 370px;
  background: linear-gradient(to bottom, rgba(0,0,0,0.8), transparent);
  pointer-events: none;
}

/* Заголовок — верхний левый угол */
.player__header {
  position: absolute; top: 80px; left: 140px;
  max-width: 1400px; z-index: 6;
}
.player__title {
  font-size: 64px; font-weight: bold;
}
.player__episode {
  font-size: 32px; color: #ccc; margin-top: 10px;
}
```

Убрать `player__overlay`, `player__controls-row`, `player__controls`, `.pctl` — экранных кнопок больше не будет.


## Этап 2. Новый прогресс-бар (низ экрана, стиль KPSTV)

Сейчас: тонкая полоска 6px + текст времени внизу.

Сделать: полноценный прогресс-бар с точкой, seek-time при перемотке, stream-info.

### CSS

```css
.player__bar {
  position: absolute; bottom: 0; left: 0; width: 100%;
  height: 370px;
  background: linear-gradient(to top, rgba(0,0,0,0.8), transparent);
  pointer-events: none;
}
.player__bar-wrap {
  position: absolute; bottom: 150px; left: 5%; width: 90%;
}
.player__bar-progress {
  position: absolute; left: 0; right: 140px;
  height: 14px; top: 28px;
  background: rgba(255,255,255,0.4); border-radius: 4px;
}
.player__bar-value {
  background: #e94560; border-radius: 4px; height: 100%; position: relative;
}
.player__bar-dot {
  position: absolute; right: -12px; top: -9px;
  width: 30px; height: 30px; border-radius: 50%;
  background: #e94560; border: 2px solid #fff;
  box-shadow: 0 0 5px #000;
}
.player__bar-seek {
  position: absolute; top: -55px; left: -50px; width: 130px;
  font-size: 28px; text-align: center;
}
.player__bar-duration {
  position: absolute; right: 0; line-height: 70px; font-size: 28px;
}
.player__bar-stream {
  position: absolute; bottom: 50px; left: 5%; width: 90%;
  font-size: 24px; color: #aaa;
}
```

### JS (updateProgress)

```js
function updateProgress() {
  if (!videoEl) return;
  var cur = seeking ? seekPos : videoEl.currentTime;
  var dur = videoEl.duration || 1;
  var pct = (cur / dur) * 100;
  $root.find('.player__bar-value').css('width', pct + '%');
  $root.find('.player__bar-duration').text(formatTime(cur) + ' / ' + formatTime(dur));
  // при перемотке показать seek-time на точке
  if (seeking) {
    $root.find('.player__bar-seek').text(formatTime(seekPos));
  }
}
```


## Этап 3. OSD иконка действия (центр экрана)

Сейчас: нет визуального фидбека при play/pause.

Сделать: большая полупрозрачная иконка по центру (play/pause/rw/ff), исчезающая через 0.7 сек.

### CSS

```css
.player__osd {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  font-size: 120px; color: rgba(255,255,255,0.7);
  pointer-events: none; z-index: 7;
  text-shadow: 0 0 20px rgba(0,0,0,0.5);
  transition: opacity 0.3s;
}
.player__osd.hidden { opacity: 0; }
```

### JS

```js
var osdTimer = null;
function showOsd(icon) {  // 'play', 'pause', 'rw', 'ff'
  var symbols = { play: '▶', pause: '❚❚', rw: '⏪', ff: '⏩' };
  $root.find('.player__osd').text(symbols[icon] || icon).removeClass('hidden');
  if (osdTimer) clearTimeout(osdTimer);
  osdTimer = setTimeout(function() {
    $root.find('.player__osd').addClass('hidden');
    osdTimer = null;
  }, 700);
}
```


## Этап 4. Панель настроек снизу (вместо правого меню)

Сейчас: правая панель 460px на всю высоту экрана с табами Качество/Аудио/Субтитры.

Сделать: три кнопки [Аудио] [Субтитры] [Качество] выезжают снизу по центру. При выборе кнопки — выезжает панель со списком.

### Шаблон

```
<div class="player__panel hidden">
  <div class="ppanel__overlay"></div>
  <div class="ppanel__buttons">
    <div class="ppanel__btn ppanel__btn--audio focusable">
      <span class="ppanel__btn-icon ppanel__btn-icon--audio"></span>
      <span class="ppanel__btn-label">Дорожка 1</span>
    </div>
    <div class="ppanel__btn ppanel__btn--subs focusable">
      <span class="ppanel__btn-icon ppanel__btn-icon--subs"></span>
      <span class="ppanel__btn-label">Выкл</span>
    </div>
    <div class="ppanel__btn ppanel__btn--quality focusable">
      <span class="ppanel__btn-icon ppanel__btn-icon--quality"></span>
      <span class="ppanel__btn-label">1080p</span>
    </div>
  </div>
  <div class="ppanel__list hidden"></div>
</div>
```

### CSS

```css
.ppanel__buttons {
  position: absolute; bottom: 0; left: 50%;
  transform: translateX(-50%) translateY(105%);
  display: flex; gap: 20px; padding: 30px;
  background: rgba(0,0,0,0.9);
  border-radius: 10px 10px 0 0;
  transition: transform 0.2s ease-in-out;
}
.ppanel__buttons.active {
  transform: translateX(-50%) translateY(0);
}
.ppanel__btn {
  width: 380px; background: #555; padding: 0 14px;
  font-size: 24px; line-height: 72px; white-space: nowrap;
}
.ppanel__btn.focused { outline: 2px solid #fff; }
.ppanel__btn-icon {
  display: inline-block; width: 48px; height: 48px;
  vertical-align: middle; margin-right: 5px;
  /* background-image: svg иконки */
}
.ppanel__btn-label {
  display: inline-block; vertical-align: middle;
  overflow: hidden; text-overflow: ellipsis; width: 300px;
}
.ppanel__list {
  position: absolute; bottom: 0;
  left: 55%; margin-left: -20%; width: 40%;
  background: rgba(0,0,0,0.9);
  border-radius: 10px 10px 0 0;
  transform: translateY(105%);
  transition: transform 0.2s ease-in-out;
}
.ppanel__list.active { transform: translateY(0); }
```

### Навигация

- **Down** (при обычном воспроизведении) → показать ppanel__buttons, фокус на первой кнопке
- **Left/Right** → переход между кнопками audio/subs/quality
- **Enter** на кнопке → открыть ppanel__list с соответствующим списком
- **Up/Down** в списке → навигация, Enter → применить и закрыть
- **Return** → закрыть панель

Убрать: весь код `pmenu`, `pmenu__tabs`, `pmenu__items`, `player__menu`, функции `renderMenu`, `openMenu`, `closeMenu`, `handleMenuKey`, `switchMenuSection`.


## Этап 5. Ускоряющаяся перемотка (как KPSTV)

Сейчас: фиксированный шаг +/-15 сек.

Сделать: при зажатии Left/Right шаг ускоряется, реальный seek по debounce.

### JS

```js
var seekPos = -1;
var seekCount = 0;
var seekDir = '';
var seeking = false;
var seekApplyTimer = null;

function startSeek(dir) {  // 'left' или 'right'
  seeking = true;
  if (seekDir !== dir) { seekDir = dir; seekCount = 0; }
  if (seekPos === -1) seekPos = videoEl.currentTime;

  var step = 10 + Math.pow(Math.min(seekCount, 3000), 3) / 1000;
  seekPos += dir === 'right' ? step : -step;
  seekPos = Math.max(0, Math.min(seekPos, videoEl.duration - 2));
  seekCount++;

  updateProgress();       // показать seek-time на прогресс-баре
  showOsd(dir === 'right' ? 'ff' : 'rw');
  showBar();

  // debounce: применить seek через 2 сек бездействия
  if (seekApplyTimer) clearTimeout(seekApplyTimer);
  seekApplyTimer = setTimeout(applySeek, 2000);
}

function applySeek() {
  if (!seeking || seekPos < 0) return;
  videoEl.currentTime = seekPos;
  resetSeek();
}

function resetSeek() {
  seekPos = -1; seekCount = 0; seekDir = ''; seeking = false;
  seekApplyTimer = null;
}
```


## Этап 6. Переключение Enter → play/pause (без экранных кнопок)

Сейчас: Enter → показать экранные кнопки (controlsOpen), навигация по ним.

Сделать: Enter → toggle play/pause + showOsd. Убрать `controlsOpen`, `controlsFocused`, `renderControlsFocus`, `showControls`, `hideControls`, `handleControlsKey`.

### Новая handleKey

```js
function handleKey(e) {
  if (!videoEl) return;
  if (panelOpen) { handlePanelKey(e); return; }

  switch (e.keyCode) {
    case TvKey.Return: case TvKey.Backspace: case TvKey.Escape: case TvKey.Stop:
      destroyPlayer(); goBack(); break;

    case TvKey.Enter: case TvKey.PlayPause:
      if (videoEl.paused) { videoEl.play(); showOsd('play'); }
      else { videoEl.pause(); showOsd('pause'); }
      showBar(); break;

    case TvKey.Play:
      if (videoEl.paused) { videoEl.play(); showOsd('play'); showBar(); }
      break;
    case TvKey.Pause:
      videoEl.pause(); showOsd('pause'); showBar(); break;

    case TvKey.Left: case TvKey.Rw:
      startSeek('left'); break;
    case TvKey.Right: case TvKey.Ff:
      startSeek('right'); break;

    case TvKey.Up:
      showBar(); break;
    case TvKey.Down:
      openPanel(); break;

    case TvKey.Green: changeSubSize(1); break;
    case TvKey.Red: changeSubSize(-1); break;
  }
  e.preventDefault();
}
```


## Этап 7. Показ/скрытие OSD (header + bar)

Сейчас: один `player__overlay` с автоскрытием 4 сек.

Сделать: `player__header`, `player__gradient` и `player__bar` показываются/скрываются синхронно.

```js
function showBar() {
  $root.find('.player__header, .player__gradient, .player__bar').removeClass('hidden');
  clearBarTimer();
  if (!panelOpen && !seeking) {
    barTimer = setTimeout(hideBar, 4000);
  }
}
function hideBar() {
  $root.find('.player__header, .player__gradient, .player__bar').addClass('hidden');
}
```


## Этап 8. Prev/Next эпизод через Rw/Ff

Сейчас: Rw/Ff → перемотка. Prev/Next — только через экранные кнопки.

Сделать (как KPSTV):
- **Rw** при `currentTime < 20` → seek(0) (начало текущего)
- **Rw** с зажатием (или двойное нажатие) → предыдущий эпизод
- **Ff** с зажатием → следующий эпизод
- По окончании (`complete` event) → автоматически следующий эпизод

Можно оставить простую логику: Rw/Ff — перемотка (как Left/Right), а переключение эпизодов — через кнопки ChannelUp/ChannelDown или через двойной Rw/Ff с debounce.


## Итого: что удалить

- Шаблон `tplMenu`, `tplMenuItem`
- Все CSS: `.player__overlay`, `.player__controls-row`, `.player__controls`, `.pctl`, `.pmenu`, `.pmenu__tabs`, `.pmenu__items`, `.pmenu__item`, `.player__menu`
- JS: `controlsOpen`, `controlsFocused`, `CONTROLS`, `showControls`, `hideControls`, `renderControlsFocus`, `handleControlsKey`, `executeControl`, все `menuOpen`/`menuSection` старые
- Шаблон `player__progress`, `player__progress-bar`, `player__time`

## Итого: что добавить

- Шаблон: `player__gradient`, `player__header`, `player__episode`, `player__bar` (новый), `player__osd`, `player__panel` (новый)
- CSS: ~120 строк нового, ~80 строк удаленного
- JS: `showOsd`, `startSeek/applySeek/resetSeek`, `openPanel/closePanel/handlePanelKey`, новая `handleKey`

## Порядок реализации

1. **CSS** — добавить новые стили, оставить старые пока на месте
2. **Шаблон** — заменить `tplPlayer` на новый
3. **OSD** — добавить `showOsd()`
4. **Прогресс-бар** — переделать `updateProgress()` и `showBar()/hideBar()`
5. **Перемотка** — заменить фиксированные +-15 сек на ускоряющуюся
6. **handleKey** — убрать controlsOpen логику, Enter → play/pause
7. **Панель настроек** — заменить правое меню на нижнюю панель
8. **Удалить** — старый CSS и мертвый JS код
