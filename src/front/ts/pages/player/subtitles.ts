import $ from 'jquery';
import { Subtitle } from '../../types/api';
import { storage, Storage, ProxyCategory } from '../../utils/storage';
import { Logger } from '../../utils/log';
import { isModernHls } from './hls-adapter';

let subStyleEl: HTMLStyleElement | null = null;

// Dynamic part of the subtitle style (size + line-height), applied to both the
// native cue (modern path) and the HTML overlay (legacy path). Static styling
// (position, colour, shadow, font) lives in app.css.
export const applySubSize = (): void => {
  const size = storage.getSubSize();
  if (!subStyleEl) {
    subStyleEl = document.createElement('style');
    document.head.appendChild(subStyleEl);
  }

  // Larger sizes -> smaller line-height for compactness. Min 22px -> 1.6, Max 82px -> 1.1
  const lineHeightRange = 1.6 - 1.1; // 0.5
  const sizeRange = Storage.SUB_SIZE_MAX - Storage.SUB_SIZE_MIN; // 60
  const sizeProgress = (size - Storage.SUB_SIZE_MIN) / sizeRange; // 0 to 1
  const lineHeight = (1.6 - lineHeightRange * sizeProgress).toFixed(2);

  subStyleEl.textContent =
    'video::cue, .player__subs { ' +
      'font-size: ' + size + 'px !important; ' +
      'line-height: ' + lineHeight + ' !important; ' +
    '}';
};

const srtToVtt = (srt: string): string =>
  'WEBVTT\n\n' + srt
    .replace(/\r\n/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');

interface Cue {
  readonly start: number;
  readonly end: number;
  readonly html: string;
}

// "00:00:55,696" / "00:00:55.696" -> seconds. Returns -1 on malformed input.
const parseTimeSec = (t: string): number => {
  const m = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/.exec(t);
  if (!m) return -1;
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4]) / 1000;
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Cue text -> safe display HTML: drop ASS overrides ({\an8}) and any markup
// tags (<i>, <font>, ...), escape the rest, keep line breaks as <br>.
const cueText = (lines: ReadonlyArray<string>): string =>
  lines
    .map((l) => escapeHtml(l.replace(/\{[^}]*\}/g, '').replace(/<[^>]*>/g, '')))
    .join('<br>');

const parseSrt = (srt: string): Cue[] => {
  const blocks = srt.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split(/\n{2,}/);
  return blocks
    .map((block): Cue | null => {
      const raw = block.split('\n').filter((l) => l.trim().length > 0);
      // skip a leading numeric index; the timing line is the one with '-->'
      let ti = 0;
      while (ti < raw.length && raw[ti].indexOf('-->') < 0) ti++;
      if (ti >= raw.length) return null;
      const tparts = raw[ti].split('-->');
      const start = parseTimeSec(tparts[0]);
      const end = parseTimeSec(tparts[1] || '');
      const textLines = raw.slice(ti + 1);
      if (start < 0 || end < 0 || textLines.length === 0) return null;
      return { start, end, html: cueText(textLines) };
    })
    .filter((c): c is Cue => c !== null);
};

// Loads subtitles via one of two paths chosen by the active hls.js (= the
// "Старый телевизор" toggle):
//   - modern hls (Tizen 3.0+, Android TV, browser): native <track>/::cue, which
//     these platforms composite over the video — original, proven path.
//   - legacy hls (Tizen 2.3): the OS paints video in a hardware plane that does
//     NOT composite native cues, so we parse the SRT ourselves and render the
//     active line in an HTML overlay (.player__subs) driven by the video clock.
export class SubtitleLoader {
  private readonly log: Logger;
  private videoEl: HTMLVideoElement | null = null;
  private overlay: HTMLElement | null = null;
  private cues: ReadonlyArray<Cue> = [];
  private timeHandler: (() => void) | null = null;
  private reqToken = 0;
  private shownIdx = -1;

  constructor(log?: Logger) {
    this.log = log || new Logger('subs-diag');
  }

  load(videoEl: HTMLVideoElement, $root: JQuery, subs: Subtitle[], subIdx: number): void {
    this.detach();
    this.videoEl = videoEl;
    this.overlay = this.ensureOverlay($root);

    if (isModernHls()) this.loadNative($root, subs, subIdx);
    else this.loadOverlay(subs, subIdx);
  }

  destroy(): void {
    this.detach();
    this.clearOverlay();
    this.videoEl = null;
    this.overlay = null;
  }

  // --- modern path: native <track> ---

  private loadNative($root: JQuery, subs: Subtitle[], subIdx: number): void {
    const v = this.videoEl;
    if (!v) return;
    $root.find('video track').remove();
    const tracks = v.textTracks;
    for (let i = 0; i < tracks.length; i++) tracks[i].mode = 'disabled';

    if (subIdx < 0 || subIdx >= subs.length) return;

    const sub = subs[subIdx];
    const token = ++this.reqToken;
    const subUrl = storage.getRewrittenUrl(ProxyCategory.Subtitles, sub.url);
    this.log.debug('native loading idx={idx} lang={lang} url={url}', { idx: subIdx, lang: sub.lang, url: subUrl });

    const addTrack = (src: string): void => {
      if (!v.parentNode) return;
      const track = document.createElement('track');
      track.kind = 'subtitles';
      track.label = sub.lang;
      track.srclang = sub.lang;
      track.src = src;
      track.setAttribute('default', '');
      track.addEventListener('load', () => {
        const idx = v.textTracks.length - 1;
        if (idx >= 0) v.textTracks[idx].mode = 'showing';
      });
      track.addEventListener('error', () => this.log.warn('track element error', {}));
      v.appendChild(track);
      if (v.textTracks.length > 0) v.textTracks[v.textTracks.length - 1].mode = 'showing';
    };

    // CDN lacks Access-Control-Allow-Origin, so a direct <track src> errors; the
    // 'subtitles' proxy category (on by default) routes the fetch through us.
    $.ajax({
      url: subUrl,
      dataType: 'text',
      success: (data: string) => {
        if (token !== this.reqToken || !v.parentNode) return;
        const blob = new Blob([srtToVtt(data)], { type: 'text/vtt' });
        // URL.createObjectURL exists on Tizen 2.3 (Chrome 23+); only new URL() is missing.
        // eslint-disable-next-line compat/compat
        addTrack(URL.createObjectURL(blob));
      },
      error: (_xhr, status, err) => {
        if (token !== this.reqToken || !v.parentNode) return;
        this.log.warn('native ajax error status={status} err={err}', { status: String(status), err: String(err) });
        addTrack(subUrl);
      },
    });
  }

  // --- legacy path: HTML overlay driven by the video clock ---

  private loadOverlay(subs: Subtitle[], subIdx: number): void {
    if (subIdx < 0 || subIdx >= subs.length) { this.clearOverlay(); return; }

    const sub = subs[subIdx];
    const token = ++this.reqToken;
    const subUrl = storage.getRewrittenUrl(ProxyCategory.Subtitles, sub.url);
    this.log.debug('overlay loading idx={idx} lang={lang} url={url}', { idx: subIdx, lang: sub.lang, url: subUrl });

    $.ajax({
      url: subUrl,
      dataType: 'text',
      success: (data: string) => {
        if (token !== this.reqToken || !this.videoEl) return;
        const cues = parseSrt(data);
        this.log.debug('overlay parsed cues={cues} len={len}', { cues: cues.length, len: data.length });
        this.cues = cues;
        this.attachOverlay();
      },
      error: (_xhr, status, err) => {
        if (token !== this.reqToken) return;
        this.log.warn('overlay ajax error status={status} err={err}', { status: String(status), err: String(err) });
      },
    });
  }

  private ensureOverlay($root: JQuery): HTMLElement {
    const found = $root.find('.player__subs')[0] as HTMLElement | undefined;
    if (found) return found;
    const el = document.createElement('div');
    el.className = 'player__subs';
    const player = ($root.find('.player')[0] || $root[0]) as HTMLElement;
    player.appendChild(el);
    return el;
  }

  private attachOverlay(): void {
    const v = this.videoEl;
    if (!v) return;
    const handler = (): void => this.render(v.currentTime);
    this.timeHandler = handler;
    v.addEventListener('timeupdate', handler);
    v.addEventListener('seeked', handler);
    this.shownIdx = -1;
    this.render(v.currentTime);
  }

  private detach(): void {
    const v = this.videoEl;
    if (v && this.timeHandler) {
      v.removeEventListener('timeupdate', this.timeHandler);
      v.removeEventListener('seeked', this.timeHandler);
    }
    this.timeHandler = null;
    this.cues = [];
    this.shownIdx = -1;
  }

  private clearOverlay(): void {
    if (this.overlay) this.overlay.innerHTML = '';
  }

  private render(t: number): void {
    const cues = this.cues;
    let idx = -1;
    for (let i = 0; i < cues.length; i++) {
      if (t >= cues[i].start && t <= cues[i].end) { idx = i; break; }
      if (cues[i].start > t) break; // cues are time-ordered; nothing further matches
    }
    if (idx === this.shownIdx) return;
    this.shownIdx = idx;
    if (!this.overlay) return;
    this.overlay.innerHTML = idx >= 0 ? '<span>' + cues[idx].html + '</span>' : '';
  }
}
