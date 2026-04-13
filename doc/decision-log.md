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
