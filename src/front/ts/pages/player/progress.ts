import { formatTimecode } from '../../utils/format';
import { Lazy } from '../../utils/lazy';

export interface ProgressBarDeps {
  readonly $root: JQuery;
  readonly getVideoEl: () => HTMLVideoElement | null;
  readonly getDurationHint: () => number;
  readonly getSeekActive: () => boolean;
  readonly getSeekPos: () => number;
}

export class ProgressBar {
  private readonly barValue: Lazy<HTMLElement | null>;
  private readonly barPct: Lazy<HTMLElement | null>;
  private readonly barDuration: Lazy<HTMLElement | null>;
  private readonly barSeek: Lazy<HTMLElement | null>;

  constructor(private readonly deps: ProgressBarDeps) {
    const $root = deps.$root;
    this.barValue = new Lazy(() => $root.find('.player__bar-value')[0] || null);
    this.barPct = new Lazy(() => $root.find('.player__bar-pct')[0] || null);
    this.barDuration = new Lazy(() => $root.find('.player__bar-duration')[0] || null);
    this.barSeek = new Lazy(() => $root.find('.player__bar-seek')[0] || null);
  }

  getDuration(): number {
    const videoEl = this.deps.getVideoEl();
    let api = this.deps.getDurationHint() || 0;
    if (videoEl) {
      let d = videoEl.duration;
      if (d && !isNaN(d) && isFinite(d) && d > 0) {
        // Tizen 2.3 (Chrome 28) may report duration in ms instead of seconds
        if (api > 0 && d > api * 100) d = d / 1000;
        return d;
      }
    }
    if (api > 86400) api = api / 1000;
    return api;
  }

  update(): void {
    const videoEl = this.deps.getVideoEl();
    if (!videoEl) return;
    const seeking = this.deps.getSeekActive();
    const seekPos = this.deps.getSeekPos();
    let cur = seeking ? seekPos : videoEl.currentTime;
    const dur = this.getDuration();
    if (cur < 0) cur = 0;
    let pct = dur > 0 ? (cur / dur) * 100 : 0;
    if (pct > 100) pct = 100;
    const barValue = this.barValue.get();
    const barPct = this.barPct.get();
    const barDuration = this.barDuration.get();
    const barSeek = this.barSeek.get();
    if (barValue) barValue.style.width = pct + '%';
    if (barPct) barPct.innerHTML = pct.toFixed(1) + '%';
    if (barDuration) {
      barDuration.innerHTML = formatTimecode(cur) + (dur > 0 ? ' / ' + formatTimecode(dur) : '');
    }
    if (barSeek) {
      barSeek.innerHTML = seeking ? formatTimecode(seekPos) : '';
    }
  }

  resetElements(): void {
    this.barValue.reset();
    this.barPct.reset();
    this.barDuration.reset();
    this.barSeek.reset();
  }
}
