# Player Flow

## Состояние плеера

Всё состояние воспроизведения хранится в одном объекте `PlayState`:

```ts
interface PlayState {
  quality: number;   // индекс в currentFiles
  audio: number;     // индекс в currentAudios
  sub: number;       // индекс в currentSubs (-1 = выкл)
  position: number;  // секунды
  paused: boolean;
}
```

Единый метод `continuePlaying(next, title?)` сравнивает `next` с текущим `state`
и выполняет минимально необходимое действие.

## Запуск воспроизведения

```mermaid
flowchart TD
    A([mount: params]) --> B[showSpinner]
    B --> C[getItem id]
    C --> D[findEpisodeMedia / findVideoMedia\ngetResumeTime → pos]
    D --> E[loadMediaLinks mid]
    E --> F[sort files by width\nrestoreQualityIndex / restoreAudioIndex / restoreSubIndex]
    F --> G["continuePlaying({ q, a, s, pos, paused:false }, title)"]

    G --> H{videoEl == null?\nпервый запуск}
    H -- да --> I[playUrl: создать video element\nnavigateListeners: ended/waiting/error/...]
    I --> J[playSource rewriteUrl]
    H -- нет --> J

    J --> K[hls.js: new Hls startPosition=pos\nhls.loadSource → hls.attachMedia]
    K --> L([MANIFEST_PARSED])
    L --> M[onSourceReady]

    M --> N{state.position > 0?}
    N -- да --> O["play, doSeek на playing/canplay/3s timeout"]
    N -- нет --> P[play]
    O --> Q[loadSubtitleTrack если state.sub >= 0\nhideSpinner / startMarkTimer / showBar]
    P --> Q
```

## continuePlaying — единая точка входа

```mermaid
flowchart TD
    A(["continuePlaying(next)"]) --> B{quality или audio\nизменились?\nили videoEl == null?}

    B -- да --> C[getHlsUrl → getRewrittenHlsUrl\n/hls/rewrite?url=...&audio=N]
    C --> D{videoEl == null?}
    D -- да --> E[playUrl + playSource\nсоздать video element]
    D -- нет --> F[showSpinner\nplaySource rewriteUrl\nhls.js startPosition = next.position]
    E & F --> G([MANIFEST_PARSED → onSourceReady\nвосстановление позиции + субтитры])

    B -- нет --> H{position изменился\nболее чем на 2с?}
    H -- да --> I[videoEl.currentTime = pos]
    H -- нет --> J{sub изменился?}
    I --> J
    J -- да --> K[loadSubtitleTrack]
    J -- нет --> L([ничего не делать])
```

## Выбор HLS URL

```mermaid
flowchart TD
    A([getHlsUrl file]) --> B{isLegacyTizen?}
    B -- да --> C[hls2 всегда]
    B -- нет --> D{streamingType?}
    D -- hls4 --> E[hls4]
    D -- hls2 --> F[hls2]
    D -- hls / auto --> G[hls4 || hls2]
```

## Перемотка

```mermaid
flowchart TD
    A([Left/Right]) --> B[startSeek: seekPos += step\nOSD / progressBar]
    B --> C[таймер 2с]
    C --> D[applySeek]
    D --> E["continuePlaying({ ...state, position: seekPos })"]
    E --> F{position изменился > 2с}
    F -- да --> G[videoEl.currentTime = pos]
```

## Панель: аудио / субтитры / качество

```mermaid
flowchart TD
    A([Up → panelOpen]) --> B[панель: аудио / субтитры / качество]

    B --> C([onApplyAudio idx])
    C --> D["continuePlaying({ ...state, audio: idx, position: currentPosition() })"]
    D --> E[quality или audio изменились → пересоздать HLS]

    B --> F([onApplySub menuIdx])
    F --> G["continuePlaying({ ...state, sub: menuIdx-1 })"]
    G --> H[только sub изменился → loadSubtitleTrack]

    B --> I([onApplyQuality idx])
    I --> J["continuePlaying({ quality: idx, ...state, position: currentPosition() })"]
    J --> E
```

## Прогресс и маркировка просмотра

```mermaid
flowchart TD
    A([startMarkTimer\nкаждые 30с]) --> B[markTime API\nсохранить позицию]
    B --> C{dur - time\n<= threshold?}
    C -- "да\nфильм 420с / серия 120с" --> D[toggleWatched API\nmarkedWatched = true]
    C -- нет --> E([ждём следующего тика])

    F([video: ended]) --> G[markWatched]
    G --> H{есть следующий\nэпизод/видео?}
    H -- да --> I[savePosition\ndestroyPlayer\nremountTrack → continuePlaying]
    H -- нет --> J[goBack]
```

## Управление с пульта

```mermaid
flowchart TD
    A([keydown]) --> B{panelState.open?}
    B -- да --> C[handlePanelKey\nпанель аудио/суб/качество]
    B -- нет --> D{keyCode}

    D -- "Enter/PlayPause" --> E{paused?}
    E -- да --> F["play, state.paused = false"]
    E -- нет --> G["pause, state.paused = true"]

    D -- Left/Rw --> H[startSeek left\nшаг 10–∞с]
    D -- Right/Ff --> I[startSeek right]
    H & I --> J["таймер 2с → applySeek → continuePlaying"]

    D -- Up --> K[panelOpen\nаудио / субтитры / качество]
    D -- TrackNext --> L[navigateTrack +1]
    D -- TrackPrev --> M[navigateTrack -1]
    D -- Return/Back --> N[destroyPlayer\ngoBack]
```

## Завершение / уничтожение

```mermaid
flowchart TD
    A([destroyPlayer]) --> B[savePosition]
    B --> C[stopMarkTimer\nstopProgressTimer\nclearBarTimer]
    C --> D["hlsInstance.destroy\nvideoEl.pause\nvideoEl = null"]
    D --> E["currentHlsUrl = ''"]

    F([unmount]) --> A
    F --> G[keys.unbind\nclearPage]
```
