# Анализ плеера KinoPub STV (kpstv.net)

Источники: `tmp/bundle.from.jsnice.js`, `http://kpstv.net/app/tizen/style.min.css`

## Архитектура

Приложение написано на **Svelte**, использует компонентный подход и собственный абстрактный плеер (`TizenPlayer`).

## Сцена плеера (`k1ihmbee`)

```
.scene.player.k1ihmbee         ← fullscreen, background: transparent
  .root.k1ihmbee
    .subtitles                  ← bottom:8%, поднимается до 20% при наличии UI
    .gradient                   ← player-gradient2.png сверху (370rem)
    [компонент Title]           ← h1 с названием (left:140, top:80)
    [компонент Episode]         ← под заголовком (left:140, top:170)
    [компонент Clock]           ← right:140, top:80 (опционально)
    [компонент ProgressBar]     ← kjriym3
    [компонент Controls]        ← ktj9ulq
```

## Прогресс-бар (`kjriym3`)

```
.root.kjriym3                   ← gradient background снизу, height:370rem
  .wrapper                      ← bottom:150rem, left:5%, width:90%
    .progress-wrapper           ← left:0, right:140rem (место для duration)
      .progress                 ← белая полоска 14rem, rounded
        .value                  ← зеленая (#71bb44) заливка
          .dot                  ← круглый индикатор (30x30rem) на конце
            .seek-time          ← текст времени при перемотке (30rem font)
    .duration                   ← справа, line-height:70rem
  .stream                       ← bottom:50rem, info о потоке (28rem font)
```

### CSS прогресс-бара

```css
.root.kjriym3 {
  background: url(images/player-gradient.png) no-repeat;
  background-size: contain;
  bottom: 0;
  height: 370rem;
  left: 0;
  position: absolute;
  width: 100%;
}
.root.kjriym3 .wrapper {
  bottom: 150rem;
  left: 5%;
  position: absolute;
  width: 90%;
}
.root.kjriym3 .wrapper .progress-wrapper {
  height: 70rem;
  left: 0;
  position: absolute;
  right: 140rem;
}
.root.kjriym3 .wrapper .progress-wrapper .progress {
  background: hsla(0,0%,100%,.6);
  border-radius: 4rem;
  height: 14rem;
  position: absolute;
  top: 28rem;
  width: 100%;
}
.root.kjriym3 .wrapper .progress-wrapper .progress .value {
  background: #71bb44;
  border-radius: 4rem;
  height: 100%;
  position: relative;
}
.root.kjriym3 .wrapper .progress-wrapper .progress .value .dot {
  background: #71bb44;
  border: 2rem solid #fff;
  border-radius: 50%;
  box-shadow: 0 0 5rem #000;
  height: 30rem;
  position: absolute;
  right: -10rem;
  top: -10rem;
  width: 30rem;
}
.root.kjriym3 .wrapper .progress-wrapper .progress .value .dot .seek-time {
  font-size: 30rem;
  left: -50rem;
  position: absolute;
  text-align: center;
  top: -60rem;
  width: 130rem;
}
.root.kjriym3 .wrapper .duration {
  line-height: 70rem;
  position: absolute;
  right: 0;
}
.root.kjriym3 .stream {
  bottom: 50rem;
  font-size: 28rem;
  left: 5%;
  position: absolute;
  width: 90%;
}
```

## Панель управления (`ktj9ulq`)

```
.root.ktj9ulq                      ← fixed bottom
  .overlay                          ← fullscreen затемнение (1920x1080)
  .controls                         ← centered bar (1324rem), bg rgba(0,0,0,.9)
    .button.audio.focusable         ← icon-audio.svg + label (380rem wide)
    .button.subtitles.focusable     ← icon-subtitles.svg + label
    .button.quality.focusable       ← icon-quality.svg + label
  .panel.audio                      ← выдвижная панель (40% width) со списком
  .panel.subtitles                  ← то же
  .panel.quality                    ← то же
```

Кнопки — три: **Аудио**, **Субтитры**, **Качество**. Панели выезжают снизу с анимацией `transform: translateY`.

### CSS панели управления

```css
.root.ktj9ulq {
  bottom: 0;
  left: 0;
  position: absolute;
  width: 100%;
}
.root.ktj9ulq .overlay {
  display: none;
  height: 1080rem;
  left: 0;
  position: absolute;
  top: -1080rem;
  width: 1920rem;
}
.root.ktj9ulq .overlay.active {
  display: block;
}
.root.ktj9ulq .controls {
  background: rgba(0,0,0,.9);
  border-radius: 10rem 10rem 0 0;
  bottom: -100%;
  box-shadow: 0 -5rem 10rem rgba(0,0,0,.2);
  box-sizing: border-box;
  display: flex;
  left: 50%;
  margin-left: -662rem;
  padding: 30rem;
  position: absolute;
  transform: translateY(105%);
  width: 1324rem;
}
.root.ktj9ulq .controls.active {
  transform: translateY(0);
}
.root.ktj9ulq .controls .button {
  background: #555;
  font-size: 24rem;
  line-height: 72rem;
  outline-offset: 2rem;
  padding: 0 14rem;
  white-space: nowrap;
  width: 380rem;
}
.root.ktj9ulq .controls .button .icon {
  background: 50% no-repeat;
  background-size: contain;
  display: inline-block;
  height: 48rem;
  vertical-align: middle;
  width: 48rem;
}
.root.ktj9ulq .controls .button.audio .icon {
  background-image: url(images/icon-audio.svg);
}
.root.ktj9ulq .controls .button.subtitles .icon {
  background-image: url(images/icon-subtitles.svg);
}
.root.ktj9ulq .controls .button.quality .icon {
  background-image: url(images/icon-quality.svg);
}
.root.ktj9ulq .controls .button .label {
  display: inline-block;
  margin-left: 5rem;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: middle;
  width: 320rem;
}
.root.ktj9ulq .controls .button + .button {
  margin-left: 20rem;
}
.root.ktj9ulq .controls .button.focus {
  outline: 2rem solid #fff;
}
.root.ktj9ulq .panel {
  background: rgba(0,0,0,.9);
  border-radius: 10rem 10rem 0 0;
  bottom: -100%;
  box-shadow: 0 -5rem 10rem rgba(0,0,0,.2);
  left: 55%;
  margin-left: -25%;
  position: absolute;
  transform: translateY(105%);
  width: 40%;
}
.root.ktj9ulq .panel.active {
  transform: translateY(0);
}
html.animate .controls.ktj9ulq,
html.animate .panel.ktj9ulq {
  transition: transform .2s ease-in-out;
}
```

## Заголовок и часы

```css
/* Заголовок (k1cbze7) */
.root.k1cbze7 h1 {
  font-size: 64rem;
  font-weight: 700;
  left: 140rem;
  margin: 0;
  max-width: 1400rem;
  padding: 0;
  position: absolute;
  top: 80rem;
}
.root.k1cbze7 .episode {
  color: #fff;
  left: 140rem;
  max-width: 1400rem;
  position: absolute;
  top: 170rem;
}

/* Часы (k14v3af8) */
.clock.k14v3af8 {
  color: #fff;
  font-weight: 700;
  position: absolute;
  right: 140rem;
  top: 80rem;
}
.clock.k14v3af8 .time { font-size: 42rem; }
.clock.k14v3af8 .date { font-size: 28rem; text-align: right; }
```

## Управление пультом

Нет экранных кнопок play/pause/rw/ff. Вся навигация — через кнопки пульта:

| Кнопка | Действие |
|--------|----------|
| **Enter** | Play/Pause (toggle) + показ OSD иконки "play"/"pause" |
| **Left/Right** | Перемотка (ускоряющаяся: `10 + pow(min(y, 3000), 3) / 1000` сек) |
| **Up** | Показать/скрыть overlay |
| **Down** | Открыть панель настроек (audio/subs/quality) |
| **Play/Pause/Stop** | Стандартные медиа-кнопки |
| **Rw** | Предыдущий эпизод (если < 20 сек — seek(0)) |
| **Ff** | Следующий эпизод |
| **Return** | Назад |

### Ускоряющаяся перемотка

При зажатии Left/Right скорость перемотки растет по формуле:
```
step = 10 + Math.pow(Math.min(y, 3000), 3) / 1000
```
где `y` — количество повторных нажатий. После отпускания — debounce 2 сек, потом `player.seek(val)`.

## Абстракция плеера

Плеер создается через `node.createPlayer()` и возвращает объект с event-based API:

```
player.play({ streamUrl, startPosition, autoPlay })
player.pause()
player.resume()
player.stop()
player.seek(pos)
player.getState()  → Idle / Playing / Paused
```

Events:
- `DurationChangeEvent`
- `TimeUpdateEvent`
- `ErrorEvent`
- `BufferingStartEvent` / `BufferingEndEvent`
- `PlaybackStartedEvent`
- `CompleteEvent`
- `VideoStreamChangeEvent`

Есть `TizenPlayer` (module 17064) — реализация для Samsung Tizen через AVPlay API.

## HLS и прокси

Потоки идут через прокси:
```
https://kpstv.net/api/hls2-fixer.m3u8?url=<base64>&audio=<id>&quality=<id>&sid=<session>&itemId=<id>
```
При ошибке HLS — fallback на HTTP (прямая ссылка `files[0].url`).

Субтитры — через прокси:
```
http://kpstv.net/api/subtitles-fixer.php?url=<base64>
```

## Меню настроек (audio/subs/quality)

Формат данных:
```js
options = {
  audio: [{ title: "1. Дублированный. Studio (RUS) AC3", value: 1 }, ...],
  subtitles: [{ title: "Выкл", value: -1 }, { title: "1. Русский", value: 0 }, ...],
  quality: [{ title: "Авто", value: -1 }, { title: "HEVC / 1080p", value: "h265|1080p" }, ...]
}
```

Quality сохраняется в `localStorage.getItem("quality")`.

## Сравнение с yobapub

| | KinoPub STV | yobapub |
|---|---|---|
| **Фреймворк** | Svelte (компоненты) | jQuery + doT templates |
| **Плеер** | Абстрактный API + AVPlay (Tizen native) | HTML5 `<video>` + hls.js |
| **Экранные кнопки** | Нет (только пульт) | Есть (prev/rw/play/ff/next) |
| **Перемотка** | Ускоряющаяся (прогрессивная) | Фиксированная (+/-15 сек) |
| **Меню настроек** | Выезжающая панель снизу, 3 кнопки в ряд | Вертикальное меню с табами |
| **HLS** | Через прокси kpstv.net/api/hls2-fixer.m3u8 | Напрямую через hls.js |
| **Субтитры** | SubRip через собственный парсер + прокси | VTT/native через hls.js или `<track>` |
