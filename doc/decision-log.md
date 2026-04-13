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
