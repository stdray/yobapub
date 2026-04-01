import $ from 'jquery';
import { Subtitle } from '../../types/api';
import { storage, Storage } from '../../utils/storage';

let subStyleEl: HTMLStyleElement | null = null;

export function applySubSize(): void {
  let size = storage.getSubSize();
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
}

export function changeSubSize(dir: number, showToast: (text: string) => void): void {
  let size = storage.getSubSize();
  size = Math.max(Storage.SUB_SIZE_MIN, Math.min(Storage.SUB_SIZE_MAX, size + dir * Storage.SUB_SIZE_STEP));
  storage.setSubSize(size);
  applySubSize();
  showToast('Субтитры: ' + size + 'px');
}

export function srtToVtt(srt: string): string {
  const vtt = 'WEBVTT\n\n' + srt
    .replace(/\r\n/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return vtt;
}

export function loadSubtitleTrack(videoEl: HTMLVideoElement, $root: JQuery, subs: Subtitle[], subIdx: number): void {
  $root.find('video track').remove();
  const tracks = videoEl.textTracks;
  for (var i = 0; i < tracks.length; i++) {
    tracks[i].mode = 'disabled';
  }

  if (subIdx < 0 || subIdx >= subs.length) return;

  const sub = subs[subIdx];
  const v = videoEl;

  function addTrackFromUrl(src: string): void {
    const track = document.createElement('track');
    track.kind = 'subtitles';
    track.label = sub.lang;
    track.srclang = sub.lang;
    track.src = src;
    track.setAttribute('default', '');
    v.appendChild(track);
    if (v.textTracks.length > 0) {
      v.textTracks[v.textTracks.length - 1].mode = 'showing';
    }
  }

  const subUrl = storage.proxyUrl(sub.url);

  $.ajax({
    url: subUrl,
    dataType: 'text',
    success: function (data: string) {
      if (!v || !v.parentNode) return;
      const vtt = srtToVtt(data);
      const blob = new Blob([vtt], { type: 'text/vtt' });
      addTrackFromUrl(URL.createObjectURL(blob));
    },
    error: function () {
      if (!v || !v.parentNode) return;
      addTrackFromUrl(subUrl);
    }
  });
}
