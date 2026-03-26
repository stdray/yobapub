import $ from 'jquery';
import { formatTimecode } from '../../utils/format';

export interface ProgressState {
  videoEl: HTMLVideoElement | null;
  currentDuration: number;
  seeking: boolean;
  seekPos: number;
  barValueEl: HTMLElement | null;
  barPctEl: HTMLElement | null;
  barDurationEl: HTMLElement | null;
  barSeekEl: HTMLElement | null;
}

export function getVideoDuration(state: ProgressState): number {
  var api = state.currentDuration || 0;
  if (state.videoEl) {
    var d = state.videoEl.duration;
    if (d && !isNaN(d) && isFinite(d) && d > 0) {
      // Tizen 2.3 (Chrome 28) may report duration in ms instead of seconds
      if (api > 0 && d > api * 100) d = d / 1000;
      return d;
    }
  }
  if (api > 86400) api = api / 1000;
  return api;
}

export function cacheBarElements($root: JQuery, state: ProgressState): void {
  if (!state.barValueEl) state.barValueEl = $root.find('.player__bar-value')[0] || null;
  if (!state.barPctEl) state.barPctEl = $root.find('.player__bar-pct')[0] || null;
  if (!state.barDurationEl) state.barDurationEl = $root.find('.player__bar-duration')[0] || null;
  if (!state.barSeekEl) state.barSeekEl = $root.find('.player__bar-seek')[0] || null;
}

export function updateProgress($root: JQuery, state: ProgressState): void {
  if (!state.videoEl) return;
  cacheBarElements($root, state);
  var cur = state.seeking ? state.seekPos : state.videoEl.currentTime;
  var dur = getVideoDuration(state);
  if (cur < 0) cur = 0;
  var pct = dur > 0 ? (cur / dur) * 100 : 0;
  if (pct > 100) pct = 100;
  if (state.barValueEl) {
    state.barValueEl.style.width = pct + '%';
  }
  if (state.barPctEl) {
    state.barPctEl.innerHTML = pct.toFixed(1) + '%';
  }
  if (state.barDurationEl) {
    state.barDurationEl.innerHTML = formatTimecode(cur) + (dur > 0 ? ' / ' + formatTimecode(dur) : '');
  }
  if (state.barSeekEl) {
    state.barSeekEl.innerHTML = state.seeking ? formatTimecode(state.seekPos) : '';
  }
}
