# Decision Log

Хронологический журнал принятых технических решений: время, что сделали, почему, связанные данные (логи, коммиты, тикеты). Добавляй новую запись **сверху**.

Формат записи:
```
## YYYY-MM-DD HH:MM — краткий заголовок
**Решение:** что сделали / отложили / отменили
**Причина:** почему именно так
**Данные:** ссылки на логи, коммиты, диффы, воспроизведение
**Результат:** подтвердилось / опровергнуто / ждём проверки
```

---

## 2026-04-13 22:40 — перенести resume-seek из `canplay` в `FRAG_BUFFERED`

**Решение:** в `pages/player.ts` seek на `pendingStartSeek` для resume-сценария (`pos > 0`) перенесён из обработчика `video canplay` в обработчик `hls FRAG_BUFFERED`. Seek выполняется один раз, когда `v.buffered.length > 0` (т.е. в SourceBuffer уже появилась реальная медиа-дата). Canplay теперь отвечает только за PTS-offset снап (свежий запуск, `pendingStartSeek == 0`, `ct < bStart`).

**Причина:** лог `XXWSS5jFVEia_jG-YrWlTQ` на версии `f44fb8f` (resume с pos=94, стрим с PTS-offset):

```
19:41:19 FRAG_LOADED sn=1
19:41:21 video canplay ct=0
19:41:21 startSeek target=94 from ct=0 br=[none]   ← буфер пустой!
19:41:21 video seeking ct=94
19:41:22 FRAG_BUFFERED sn=1 ct=94 br=[none]
19:41:24 FRAG_BUFFERED sn=10 start=91.52 ct=94 br=91.5-100.1
19:41:24 video playing ct=94 rs=3
19:41:24 video seeking ct=93.9999                  ← мистический второй seek
19:41:24 video seeked ct=94
19:41:25 video playing ct=94.069 rs=4
```

На момент `canplay` `video.buffered.length == 0` — FRAG_LOADED отработал, но SourceBuffer ещё не отдал append. Наш seek сработал до появления данных в буфере. Это механически эквивалентно `_seekToStartPos` в hls.js: seek на ранней фазе декодера. Далее, когда реальный fragment sn=10 всё-таки добавился, Tizen 2.3 декодер сделал свою внутреннюю I-frame-подстройку (`ct=93.9999`), и именно в этот момент звук ушёл в рассинхрон. Пользователь подтвердил: "рассинхрон звука в начале, после перемотки исправилось".

Прежняя гипотеза про "canplay эмулирует user-style seek" не выдержала: сработала в логе `88c1679` лишь потому, что в том конкретном стриме либо не было PTS-offset, либо декодер случайно прогрелся по-другому. Правильный механизм: playhead должен быть **внутри** какого-то уже буферизованного диапазона к моменту seek'а. Тогда присвоение `currentTime=target` (вне буфера) заставит hls.js выполнить `stopLoad` + `startLoad(target)` + flush SourceBuffer и скачать целевой фрагмент с нуля — это и есть тот путь, который работает при обычной ручной перемотке (см. запись 17:55).

`FRAG_BUFFERED` гарантирует, что в `v.buffered` уже есть данные: fragment sn=1 успел добавиться, playhead на ct=0 находится внутри/рядом с первым диапазоном, и seek на target=94 перекидывает playhead за пределы буфера → flush → новый fragment → декодер-резет.

**Данные:**
- лог `XXWSS5jFVEia_jG-YrWlTQ` (ver `f44fb8f`, trace `5c65`): startSeek при `br=[none]`, затем мистический seek `ct=93.9999` → рассинхрон.
- коммит `098d5d0` с правками в `pages/player.ts`: `FRAG_BUFFERED` handler, `canplay` handler.

**Результат:** ждём проверки. Ожидаемая картина: `startSeek` логируется только после первого `FRAG_BUFFERED` с непустым `br`, далее `stopLoad`/`startLoad(target)` в hls.js, `seeked` в целевой позиции без мистического второго seek и без рассинхрона.

---

## 2026-04-14 00:00 — media-кнопки пульта (Rw/Play/Pause/Ff) не доходили до JS

**Решение:** регистрировать media/color/digit клавиши через `tizen.tvinputdevice.registerKey()` в локальном `src/tizen-widget/src/index.html` **до** `document.location.replace('http://yobapub.3po.su')`. Раньше регистрация была только во фронтенде (`ts/utils/platform.ts`), но там уже нет доступа к `tizen` объекту.

**Причина:** виджет Tizen 2.3 — это тонкая обёртка: `index.html` делает redirect на внешний URL. После `location.replace` на другой origin привилегии пакета к документу не применяются и `tizen` объект отсутствует полностью (подтверждено логом `runtime probe hasTizen=false`). Соответственно `registerKey()` во фронтенде — no-op. Без регистрации Samsung не доставляет media-кнопки в WebKit вообще: в глобальном `keydown` listener'е (`gkd`) видны только стрелки/Enter (37–40, 13), ни одного `MediaPlay/MediaPause/MediaRewind/MediaFastForward` нет.

Гипотеза: `registerKey()` — это app-level настройка input-device, эффект переживает навигацию документа. Поэтому вызвать её один раз в локальном html виджета должно быть достаточно, фронтенд сам их обработает через уже существующий `handleKey` в `pages/player.ts`.

**Данные:** логи 2026-04-13T18:01:18Z `runtime probe hasTizen=false ... ua=Tizen 2.3`, отсутствие media-кодов в `platform gkd` при нажатии кнопок, `src/tizen-widget/src/index.html` (было `<script>document.location.replace(...)</script>` без регистрации), `src/front/ts/utils/platform.ts:48` (ветка `tizen.tvinputdevice not available`), `src/front/ts/pages/player.ts:988-999` (обработчики Play/Pause/Ff/Rw — уже есть).

**Уточнение 0.0.13:** логика вынесена из виджета. `src/tizen-widget/src/index.html` теперь просто `<script src="http://yobapub.3po.su/tizen-bootstrap.js">`, сам скрипт лежит во фронтенд-репо (`src/front/tizen-bootstrap.js`) и копируется webpack'ом (`CopyWebpackPlugin`) в dist как есть. Скрипт выполняется в контексте локального документа виджета (пока `location.replace` ещё не сделан), где `tizen` доступен, регистрирует ключи и уже сам редиректит. Плюс: список клавиш и URL живут в версионируемом фронтенд-коде, виджет пересобирать для изменения этого списка не нужно.

**Результат:** подтверждено на Tizen 2.3 (UJ5500, wgt 0.0.12). После установки в `platform gkd` появились коды 412 (Rw), 415 (Play), 417 (Ff), 19 (Pause), `player.handleKey` отрабатывает `startSeek`/`key Play`/`key Pause`. Диагностические логи (`runtime probe`, `gkd`, per-key keydown в player) убраны, код `registerTizenKeys` во фронтенде сжат обратно до минимального try/catch (он теперь no-op на внешнем домене, но оставлен на случай локальной подачи). Гипотеза про «`registerKey()` — app-level setting, переживает навигацию» — подтверждена.

---

## 2026-04-13 23:10 — info-панель зависала после закрытия settings-панели

**Решение:** добавил `onAfterClose` в `PanelCallbacks` (`pages/player/panel.ts`), вызываю его в `forceClosePanel` и по окончании анимации `closePanel`. В `player.ts` колбэк зовёт `showBar()`.

**Причина:** `openPanel` показывает `.player__info` через `onShowInfo`, при этом ставит `panel.open = true`. `showBar()` при открытой панели намеренно не взводит `barTimer` (иначе бар пропадёт во время выбора). После `closePanel`/idle-таймаута никто не перезапускал `showBar`, поэтому `barTimer` оставался `null`, `hideBar` не срабатывал и `.player__info` висел навсегда.

**Данные:** `src/front/ts/pages/player.ts:448-463` (`showBar`/`hideBar`, условие `!this.panel.open && !this.seek.active`), `src/front/ts/pages/player/panel.ts:166-203` (close paths).

**Результат:** ждём проверки на ТВ — typecheck проходит.

---

## 2026-04-13 22:00 — загружать с начала, seek на canplay вместо `cfg.startPosition`

**Решение:** в `pages/player.ts` убрать `cfg.startPosition` из `buildHlsConfig`. В `MANIFEST_PARSED` звать `hls.startLoad(0)` вместо `startLoad(pos)`. В playSource сохранять `this.pendingStartSeek = state.position`. В обработчике `video canplay` один раз выполнять `videoEl.currentTime = pendingStartSeek` и обнулять флаг.

**Причина:** диагностический патч `__ctLog` в `node_modules/hls.js/dist/hls.js` (5 сайтов записи `media.currentTime`) + свежий запуск 2.0.1-96 (`96105f9`) в логе `-2vdGUOuJEac9TRUyc6LUw` дали финальную картину старта:

```
ctwrap _seekToStartPos value=3857 prev=0    ← единственный JS seek
video seeking ct=3856.9999
video seeked  ct=3857      rs=3
video seeking ct=3856.9999                  ← второй seek, НЕ из JS
video playing ct=3856.9999 rs=3
video seeked  ct=3857.0297 rs=3
video playing ct=3857.0400 rs=3
video playing ct=3857.0928 rs=4             ← реальный старт
```

За весь запуск из JS происходит **ровно один** seek — `hls.js stream-controller._seekToStartPos`. Второй `seeking/seeked` и тройное `playing` с нарастанием `readyState` 3→3→4 никем в JS не инициированы — это нативное поведение декодера Tizen 2.3 WebKit во время startup-alignment (подстройка к I-frame). Именно в этом окне возникает A/V рассинхрон.

Ранее (см. `17:55` и `19:45`) уже установлено: ручной seek через `videoEl.currentTime = pos` на живом hls.js-инстансе десинк НЕ даёт. Разница между "хороший" и "плохой" seek — момент: `_seekToStartPos` выполняется на `loadedmetadata`, когда декодер ещё не прогрет; обычный runtime seek — на работающем инстансе. Переносим startup-seek в runtime: пусть hls.js грузит с самого начала (fragment 0), на `canplay` делаем обычный user-style seek. hls.js сам выполнит `stopLoad`+`startLoad(target)`+flush SourceBuffer и поднимет декодер заново — тот же путь, что и в нормальном ручном seek.

Цена: один лишний фрагмент (~5с) с начала видео перед seek'ом. Приемлемо в обмен на устранение рассинхрона.

**Данные:**
- лог `-2vdGUOuJEac9TRUyc6LUw` на версии `96105f9` — один `ctwrap _seekToStartPos`, далее natively-fired seeking/playing pairs без JS-источника.
- патч-скрипт `src/front/scripts/patch-hls.js` + `prebuild:release` hook + `Dockerfile` переведён на `npm run build:release` — гарантируют применение диагностики на CI.
- `Error().stack` на Chromium 28 V8 пустой без `throw` — подтверждено, это ожидаемо; для наших целей достаточно `site`.
- патчи в `pages/player.ts`: `buildHlsConfig`, `playSource`, `MANIFEST_PARSED` handler, `canplay` handler + новое поле `pendingStartSeek`.

**Результат:** **подтверждено.** Лог `-2vdGUOuJEac9TRUyc6LUw` на версии `88c1679` (`ba6a` trace):

```
17:24:42 startSeek target=3886 from ct=0     ← наш seek, единственный JS-инициированный
17:24:42 video seeking ct=3886
17:24:43 hls FRAG_BUFFERED sn=1 start=0      ← hls.js успел подхватить fragment 0 до flush
17:24:45 hls FRAG_BUFFERED sn=389 start=3883.2  ← flush+reload под seek
17:24:45 video seeked ct=3886 rs=3
17:24:46 video playing ct=3886.027 rs=3
17:24:46 video playing ct=3886.073 rs=4      ← стабильный старт
```

`ctwrap site=stream-controller:_seekToStartPos` в логе полностью отсутствует — hls.js не пытается делать startup seek, потому что `cfg.startPosition` не задан. Второго мистического `seeking` тоже нет. Пользователь подтверждает отсутствие рассинхрона.

Цена: один впустую скачанный фрагмент с начала (видно в `buffered=0.0-14.4,3883.2-...` после seek). Приемлемо.

Побочное наблюдение: одиночный `bufferStalledError` сразу после seek при `rs=3` — декодер догоняет ~1 секунду, nudge не срабатывает (нет gap'а), recover не нужен, далее самостоятельно выходит в `rs=4`. Нормально.

---

## 2026-04-13 21:00 — fix скролла списка сабов/аудио в панели плеера (issue #10)

**Решение:** в `scrollToFocused` (`pages/player/panel.ts`) использовать `el.offsetTop` напрямую вместо `el.offsetTop - container.offsetTop`. Плюс поднять `max-height` `.ppanel__list` c 600px до 900px.

**Причина:** `.ppanel__list` имеет `position: absolute`, значит он сам — offsetParent для своих `.ppanel__list-item`. `el.offsetTop` уже отсчитывается от списка, а вычитание `container.offsetTop` (смещение списка внутри `.player__panel`) давало произвольную константу: для верхних элементов получалось отрицательное число, scrollTop прыгал некорректно, и при большом числе дорожек прокрутка "работала неправильно" — элементы не доскролливались до видимой области. 900px даёт ~15 пунктов до появления скролла на 1080p.

**Данные:** issue #10, `src/front/ts/pages/player/panel.ts:128-140`, `src/front/css/app.css:754`.

**Результат:** ждём проверки на ТВ.

---

## 2026-04-13 19:45 — откат healing seek (он оказался причиной, а не фиксом)

**Решение:** удалить healing seek целиком — и startup (`playing` handler), и stall (`bufferStalledError` handler). Возврат обработчика stall к варианту "только `nudgePastBufferGap` + `recoverMediaError` при `hadBufferFullError`".

**Причина:** пользователь описал паттерн на лицо: "воспроизведение начинается — звук в порядке, потом лаг, воспроизведение снова — звук рассинхронизирован". Перечитал лог `mOXef-oPpES8RruV1dMKsQ` (15:53:37) под эту гипотезу:

```
video seeked ct=3287 rs=4          ← hls.js startPos seek
video playing ct=3286.9999 rs=4    ← 1-й playing, звук ОК (rs=4)
video canplay rs=4
video seeking cur=3287.0998        ← наш healingSeek стартует
healingSeek ct=3286.9999 -> 3287.0998
video seeked ct=3287.126 rs=3      ← rs упал 4→3 несмотря на in-buffer target
video playing ct=3287.17 rs=4      ← 2-й playing, рассинхрон
```

`readyState` падает с 4 до 3 при seek'е внутри уже буферизованного диапазона (3287.1 ∈ 3283.2-3302.4) — decoder перезагружает данные, и ровно после этого возникает рассинхрон. **Healing seek создавал проблему, которую якобы лечил.**

Подтверждение 18:30 (`2xJFWM3AHEunGvsCI5LLqQ`) было ложным — либо decoder в том конкретном запуске случайно ожил, либо рассинхрон был, но мы его не заметили. Confirmation bias: искали подтверждение, приняли первое совпадение.

Про "ручная перемотка лечит": это работает потому что target **вне буфера** (seek с 3287 на 3426 при buffered 3283.2-3302.4). Hls.js флашит SourceBuffer и делает fresh append новых фрагментов — вот это и ресетит decoder. Seek на `+0.1` внутри буфера такого эффекта не даёт — ни flush'а, ни нового append'а, только перезагрузка того же сегмента, которая зачем-то и роняет rs с 4 до 3.

**Данные:**
- логи: `mOXef-oPpES8RruV1dMKsQ` (десинк после healingSeek), `b9iA6oP0ckmA9j3SrLh4UA` (то же), `_yX-NfX2jEy3-ekMvJNfHQ` (без десинка, но double playing)
- откатываем коммиты `f696538` (healing seek на `playing`) и `e73ab1f` (healing seek на `bufferStalledError`) по содержимому, не через git revert — оставляем их в истории как исследование
- связанные записи: 2026-04-13 18:30 (ложно подтверждённый healing seek), 2026-04-13 19:10 (stallHealSeek на основе той же ложной гипотезы)

**Результат:** ждём проверки. Три возможных исхода:
1. **Десинка нет** — значит healing seek был чистым виновником. Проблема решена отсутствием кода.
2. **Десинк остался** — значит есть исходная причина (скорее всего `new Hls + loadSource` с `startPosition > 0` на Tizen 2.3), healing seek её только усугублял. Нужен другой механизм — например, flush через `hls.stopLoad()/startLoad()` или seek за пределы буфера.
3. **Другой паттерн десинка** — анализируем заново.

Старое объяснение "healing seek мимикрирует эффект `currentTime=pos` на существующем hls.js инстансе, который лечил рассинхрон" **неверно**: тот эффект работал потому, что target был вне буфера и hls.js делал полный reload.

---

## 2026-04-13 19:10 — healing nudge на `bufferStalledError` без gap'а

**Решение:** в обработчике `bufferStalledError` в `src/front/ts/pages/player.ts` при `!nudgePastBufferGap() && !hadBufferFullError` делаем свой `videoEl.currentTime += 0.1` (лог `hls stallHealSeek`). Раньше в этой ветке мы не делали ничего — ждали, пока hls.js сам разберётся.

**Причина:** лог `2xJFWM3AHEunGvsCI5LLqQ`, момент 15:18:31:
- `bufferStalledError` ct=2794.005, buffered=2784.0-2812.8. Playhead **внутри** буфера, 18 секунд вперёд.
- `nudgePastBufferGap` ничего не нашёл (нет gap'а впереди), `hadBufferFullError=false` — наш handler no-op.
- **10 секунд тишины.**
- 15:18:41: hls.js сам фиксит — `bufferNudgeOnStall`, seek на +0.1, playback продолжается мгновенно.

Вывод: Chromium 28 MSE decoder застревает внутри буфера (Tizen 2.3 quirk). Ровно тот же механизм, что и при старте — decoder state не синхронизирован, `currentTime += 0.1` flush'ит SourceBuffers и decoder оживает. hls.js это умеет через `bufferNudgeOnStall`, но тормозит ~10с. Делаем то же самое сами сразу при первом событии.

**Данные:**
- лог `2xJFWM3AHEunGvsCI5LLqQ`, диапазон 15:18:31 → 15:18:41
- правка в `src/front/ts/pages/player.ts` в ветке `bufferStalledError` (рядом с `nudgePastBufferGap`)
- связанная запись: 2026-04-13 18:30 (healing seek на старте — та же механика)

**Результат:** ждём проверки. Следующий лог должен показать `hls stallHealSeek` в пределах ~1с после `bufferStalledError` вместо 10-секундной паузы.

---

## 2026-04-13 18:30 — healing seek на первом `video playing`

**Решение:** на первом событии `video playing` после инициализации плеера делаем `videoEl.currentTime += 0.1`. Флаг `healingSeekDone` — one-shot, сбрасывается в `playSource` вместе с `firstFragSnapped`.

**Причина:** лог `dylDjDFiz069HEn32j8F0g` подтвердил, что ручная перемотка через `videoEl.currentTime = pos` на существующем hls.js-инстансе "лечит" рассинхрон, возникающий при `new Hls + loadSource` на Tizen 2.3. Эмулируем этот эффект в самом мягком виде — no-op seek на +0.1с сразу после старта воспроизведения, чтобы hls.js flush'нул SourceBuffers и переappend'нул фрагменты, ресетя decoder state.

**Данные:** правка в `src/front/ts/pages/player.ts` (listener на `playing`), флаг добавлен рядом с `firstFragSnapped`.

**Результат:** **подтверждено.** Лог `2xJFWM3AHEunGvsCI5LLqQ` (2026-04-13 18:18):
- `healingSeek ct=2787.9999 -> 2788.0999` отработал один раз на старте.
- Дальше `video seeked ct=2788`, `video playing` — без рассинхрона, без болтанки seeking/seeked.
- Ручная перемотка позже (`applySeek pos=3052.98`) тоже чистая.

**Побочное наблюдение:** в 15:18:31 `bufferStalledError` + `nudgePastBufferGap` (буфер 2784.0-2812.8) — это независимая проблема, вызвавшая ~10с зависания, которое пользователь описал как "зависло, потом продолжилось". К healing seek не относится, разбираем отдельно.

---

## 2026-04-13 17:55 — откатить seek-reload и починить abrEwmaFastVoD

**Решение:** (1) вернуть `abrEwmaFastVoD`/`abrEwmaSlowVoD` с capital-D (были "исправлены" на lowercase). (2) откатить коммиты `100bb18` и `2c9d705` — перемотка снова через `stopLoad + startLoad(pos) + currentTime=pos` на существующем hls.js-инстансе, без пересоздания.

**Причина:** рассинхрон звука на Tizen 2.3 есть и при начальном resume, и при ручной перемотке. Последний чистый лог `b05d3b18-e852-45b7-9229-3c39e8951c4c` не показал ни одной ошибки/recover/nudge/двойного playing — значит проблема на уровне MSE/декодера, невидима для hls.js-событий. Общее между resume и перемоткой **с 4 апреля** — полный reload hls.js через `playSource` (destroy + new Hls + loadSource). До 4 апреля перемотка делала `stopLoad/startLoad` на том же инстансе. Пользователь говорит "2 апреля проблемы не было" — окно совпадает.

Про `abrEwmaFastVoD`: hls.js 0.14.x в `node_modules/hls.js/src/config.ts` использует capital-D. `Partial<Hls.Config>` из @types принимает lowercase-вариант — типы ушли вперёд исходников. TS молчит, runtime игнорирует нашу настройку и берёт дефолт 3.0. На 2 апреля код был правильный (capital-D).

**Данные:**
- логи: `c30c5d89-e30c-49d6-a738-5aa13efe52e8`, `42857e85-4a2a-414a-abcd-e24f557e8479`, `bb5a5dab-7351-4f7d-a6c5-f0bdcad04c15`, `b05d3b18-e852-45b7-9229-3c39e8951c4c`
- коммиты под откат: `100bb18` "Restart HLS buffer on seek to avoid bufferStalledError", `2c9d705` "Reload HLS stream on seek with playSource instead of stopLoad/startLoad"
- опровергнутые гипотезы: recoverMediaError (не срабатывал ни в одном логе), gap-controller nudge (не срабатывал после правильного `startupSeekSnap`), двойной `LEVEL_SWITCHING` (починен через `autoStartLoad: false`).

**Результат:** **гипотеза подтверждена.** Лог `dylDjDFiz069HEn32j8F0g` (2026-04-13 15:04):
- Начальный resume через `playSource` (destroy + new Hls + loadSource) — рассинхрон звука **есть**. Три `video playing` события и болтанка `seeking/seeked` вокруг startPosition.
- Сразу после — ручная перемотка `applySeek pos=2462.81` через простое `videoEl.currentTime = pos` на существующем hls.js. Один чистый seek, один FRAG_BUFFERED, одно `video seeked` — рассинхрон **пропал**.

Вывод: проблема — в инициализации MSE при `new Hls + loadSource` на Tizen 2.3 Chromium 28. Обычный seek её "чинит" потому что flush'ит старые SourceBuffers и делает append заново, ресетя decoder state.

Следующий шаг: эмулировать эффект "лечебного seek" сразу после первого `video playing`/`FRAG_BUFFERED` на старте. Варианты — no-op seek на `ct+0.1`, seek на начало следующего фрагмента, принудительный flush через `hls.stopLoad()+startLoad()`. Эксперимент.
