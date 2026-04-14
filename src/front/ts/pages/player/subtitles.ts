import $ from 'jquery';
import { Subtitle } from '../../types/api';
import { storage, Storage } from '../../utils/storage';
import { Logger } from '../../utils/log';

const log = new Logger('subs-diag');

let subStyleEl: HTMLStyleElement | null = null;

export const applySubSize = (): void => {
  const size = storage.getSubSize();
  if (!subStyleEl) {
    subStyleEl = document.createElement('style');
    document.head.appendChild(subStyleEl);
  }

  // Calculate line-height: larger sizes = smaller line-height for compactness
  // Min 22px -> 1.6, Max 82px -> 1.1
  const lineHeightRange = 1.6 - 1.1; // 0.5
  const sizeRange = Storage.SUB_SIZE_MAX - Storage.SUB_SIZE_MIN; // 60
  const sizeProgress = (size - Storage.SUB_SIZE_MIN) / sizeRange; // 0 to 1
  const lineHeight = (1.6 - lineHeightRange * sizeProgress).toFixed(2);

  subStyleEl.textContent =
    'video::cue { ' +
      'font-family: "Comic Sans MS", "Comic Sans", cursive !important; ' +
      'font-size: ' + size + 'px !important; ' +
      'line-height: ' + lineHeight + ' !important; ' +
    '}';
};

export const changeSubSize = (dir: number, showToast: (text: string) => void): void => {
  let size = storage.getSubSize();
  size = Math.max(Storage.SUB_SIZE_MIN, Math.min(Storage.SUB_SIZE_MAX, size + dir * Storage.SUB_SIZE_STEP));
  storage.setSubSize(size);
  applySubSize();
  showToast('Субтитры: ' + size + 'px');
};

export const srtToVtt = (srt: string): string => {
  const vtt = 'WEBVTT\n\n' + srt
    .replace(/\r\n/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return vtt;
};

export const loadSubtitleTrack = (videoEl: HTMLVideoElement, $root: JQuery, subs: Subtitle[], subIdx: number): void => {
  $root.find('video track').remove();
  const tracks = videoEl.textTracks;
  for (let i = 0; i < tracks.length; i++) {
    tracks[i].mode = 'disabled';
  }

  if (subIdx < 0 || subIdx >= subs.length) return;

  const sub = subs[subIdx];
  const v = videoEl;

  const dumpTracks = (tag: string): void => {
    const tt = v.textTracks;
    const parts: string[] = [];
    for (let i = 0; i < tt.length; i++) {
      const cues = tt[i].cues;
      parts.push(i + ':mode=' + tt[i].mode + ',lang=' + tt[i].language + ',cues=' + (cues ? cues.length : -1));
    }
    log.info('tracks tag={tag} count={count} items={items}', { tag, count: tt.length, items: parts.join(' | ') });
  };

  const addTrackFromUrl = (src: string): void => {
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = sub.lang;
    track.srclang = sub.lang;
    track.src = src;
    track.setAttribute('default', '');
    track.addEventListener('load', () => {
      dumpTracks('track-load');
      const idx = v.textTracks.length - 1;
      if (idx >= 0) {
        v.textTracks[idx].mode = 'showing';
        log.info('forced showing idx={idx}', { idx });
        dumpTracks('after-force-showing');
      }
    });
    track.addEventListener('error', () => {
      log.warn('track element error event', {});
    });
    v.appendChild(track);
    dumpTracks('after-append');
    if (v.textTracks.length > 0) {
      v.textTracks[v.textTracks.length - 1].mode = 'showing';
    }
    dumpTracks('after-initial-showing');
  };

  const subUrl = storage.proxyUrl(sub.url);
  log.info('loading idx={idx} lang={lang} url={url}', { idx: subIdx, lang: sub.lang, url: subUrl });

  $.ajax({
    url: subUrl,
    dataType: 'text',
    success: (data: string) => {
      if (!v || !v.parentNode) return;
      log.info('ajax ok len={len} head={head}', { len: data.length, head: data.substring(0, 120) });
      const vtt = srtToVtt(data);
      log.info('vtt head={head}', { head: vtt.substring(0, 200) });
      const blob = new Blob([vtt], { type: 'text/vtt' });
      // URL.createObjectURL exists on Tizen 2.3 (Chrome 23+); only new URL() is missing.
      // eslint-disable-next-line compat/compat
      addTrackFromUrl(URL.createObjectURL(blob));
    },
    error: (_xhr, status, err) => {
      if (!v || !v.parentNode) return;
      log.warn('ajax error status={status} err={err}', { status: String(status), err: String(err) });
      addTrackFromUrl(subUrl);
    }
  });
};
