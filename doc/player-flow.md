# Player Flow

## Запуск и воспроизведение

```mermaid
flowchart TD
    A([mount: params]) --> B[showSpinner]
    B --> C[getItem id]
    C --> D[findEpisodeMedia / findVideoMedia\ngetResumeTime]
    D --> E[loadMediaLinks mid]
    E --> F[sort files by width\nкачество: дефолт из настроек или последнее для тайтла\nаудио/субтитры: последние для тайтла]
    F --> G[startWithAudio]

    G --> H{есть hls4/hls2 URL?}
    H -- да --> I[getRewrittenHlsUrl\n/hls/rewrite?url=...&audio=N\nвсегда, для любой дорожки]
    H -- нет --> J[getUrlFromFile\nhls4 / hls / http]
    I --> K[playUrl rewriteUrl]
    J --> K

    K --> L[innerHTML = tplPlayer\nvideoEl = video element]
    L --> M[addEventListener:\nended / waiting / seeking\ncanplay / playing / seeked / error]
    M --> N[playSource url]

    N --> O{url содержит\n.m3u8 или /hls?}
    O -- да --> P[videoEl.src = url\nnative HLS]
    O -- нет --> Q[videoEl.src = url\nMP4/HTTP]
    P --> R([loadedmetadata])
    Q --> R

    R --> S[onSourceReady]

    S --> T{resumeTime > 0?}
    T -- да --> U[play\nслушаем playing + canplay\ntimeout 3s → currentTime = pos]
    T -- нет --> V{resumePaused?}
    V -- нет --> W[play]
    V -- да --> X[ничего не делаем]

    U --> Y[hideSpinner\nstartMarkTimer\nshowBar\nupdateInfoBadge]
    W --> Y
    X --> Y
```

## Переключение аудиодорожки

```mermaid
flowchart TD
    A([onApplyAudio idx]) --> B{есть hls4/hls2 URL?}

    B -- да --> C[switchToRewrittenHls]
    B -- нет --> D([toast: смена недоступна])

    C --> E[getRewrittenHlsUrl\n/hls/rewrite?url=...&audio=N]
    E --> F[resumeTime = pos\nresumePaused = paused\nshowSpinner]
    F --> G[playSource rewriteUrl]
    G --> H([loadedmetadata → onSourceReady\nвосстановление позиции])
```

## Переключение качества

```mermaid
flowchart TD
    A([onApplyQuality idx]) --> B[selectedQuality = idx\nswitchQuality]
    B --> C[resumeTime = currentTime\nresumePaused = paused]
    C --> D[playSource новый URL]
    D --> E([loadedmetadata → onSourceReady\nвосстановление позиции])
```

## Прогресс и маркировка просмотра

```mermaid
flowchart TD
    A([startMarkTimer\nкаждые 30с]) --> B[markTime API\nсохранить позицию]
    B --> C{dur - time\n<= threshold?}
    C -- да\nфильм 420с / серия 120с --> D[toggleWatched API\nmarkedWatched = true]
    C -- нет --> E([ждём следующего тика])

    F([video: ended]) --> G[markWatched]
    G --> H{есть следующий\nэпизод/видео?}
    H -- да --> I[savePosition\ndestroyPlayer\nremountTrack]
    H -- нет --> J[goBack]
```

## Управление с пульта

```mermaid
flowchart TD
    A([keydown]) --> B{panelState.open?}
    B -- да --> C[handlePanelKey\nпанель аудио/суб/качество]
    B -- нет --> D{keyCode}

    D -- Enter/PlayPause --> E{paused?}
    E -- да --> F[play]
    E -- нет --> G[pause]

    D -- Left/Rw --> H[startSeek left\nшаг 10–∞с]
    D -- Right/Ff --> I[startSeek right]
    H & I --> J[таймер 2с → applySeek\nvideoEl.currentTime = seekPos]

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
    C --> D[videoEl.pause\nremoveAttribute src\nvideoEl.load\nvideoEl = null]
    D --> E[currentHlsUrl = '']

    F([unmount]) --> A
    F --> G[keys.unbind\nclearPage]
```
