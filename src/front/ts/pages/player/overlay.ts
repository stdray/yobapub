import { Lazy } from '../../utils/lazy';
import { Logger } from '../../utils/log';
import { VideoFile, AudioTrack, Subtitle } from '../../types/api';
import { buildSubLabel } from './panel';
import Hls from 'hls.js';

const olog = new Logger('overlay');

export type HudIcon = 'pause' | 'rw' | 'ff';

export interface FrameCounters {
  readonly total: number;
  readonly dropped: number;
}

interface OverlayDeps {
  readonly $root: JQuery;
  readonly updateProgress: () => void;
  // Badge data source (formerly PlayerInfo).
  readonly files: () => ReadonlyArray<VideoFile>;
  readonly audios: () => ReadonlyArray<AudioTrack>;
  readonly subs: () => ReadonlyArray<Subtitle>;
  readonly selectedQuality: () => number;
  readonly selectedAudio: () => number;
  readonly selectedSub: () => number;
  readonly hlsInstance: () => Hls | null;
  readonly videoEl: () => HTMLVideoElement | null;
}

const PROGRESS_TICK_MS = 1000;

const ICON_SYMBOLS: Readonly<Record<HudIcon, string>> = {
  pause: '❚❚', rw: '◀◀', ff: '▶▶',
};

const getFrameCounters = (videoEl: HTMLVideoElement | null): FrameCounters | null => {
  if (!videoEl) return null;
  const v = videoEl as unknown as {
    readonly getVideoPlaybackQuality?: () => { readonly totalVideoFrames: number; readonly droppedVideoFrames: number };
    readonly webkitDecodedFrameCount?: number;
    readonly webkitDroppedFrameCount?: number;
  };
  if (typeof v.getVideoPlaybackQuality === 'function') {
    const q = v.getVideoPlaybackQuality();
    if (q.totalVideoFrames > 0) return { total: q.totalVideoFrames, dropped: q.droppedVideoFrames };
  }
  if (typeof v.webkitDecodedFrameCount === 'number' && v.webkitDecodedFrameCount > 0) {
    return { total: v.webkitDecodedFrameCount, dropped: v.webkitDroppedFrameCount || 0 };
  }
  return null;
};

export class OverlayView {
  private progressTimer: number | null = null;

  private readonly $spinner: Lazy<JQuery>;
  private readonly $hud: Lazy<JQuery>;
  private readonly $icon: Lazy<JQuery>;
  private readonly $info: Lazy<JQuery>;
  private readonly $barSeek: Lazy<JQuery>;

  private prevFrames = 0;
  private prevTime = 0;
  private currentFps: number | null = null;

  constructor(private readonly deps: OverlayDeps) {
    const $root = deps.$root;
    this.$spinner = new Lazy(() => $root.find('.player__spinner'));
    this.$hud = new Lazy(() => $root.find('.player__hud'));
    this.$icon = new Lazy(() => $root.find('.player__icon'));
    this.$info = new Lazy(() => $root.find('.player__info'));
    this.$barSeek = new Lazy(() => $root.find('.player__bar-seek'));
  }

  // Called after tplPlayer replaces the page DOM — the previous jQuery refs
  // wrap nodes that no longer exist, so the Lazy caches must be invalidated.
  resetDomCache(): void {
    this.$spinner.reset();
    this.$hud.reset();
    this.$icon.reset();
    this.$info.reset();
    this.$barSeek.reset();
  }

  showBar(): void {
    olog.info('showBar');
    this.updateBadge();
    this.$hud.get().removeClass('hidden');
    this.deps.updateProgress();
    this.startProgressTimer();
  }

  hideBar(): void {
    olog.info('hideBar');
    this.stopProgressTimer();
    this.$hud.get().addClass('hidden');
  }

  setIcon(icon: HudIcon): void {
    this.$icon.get().text(ICON_SYMBOLS[icon]).removeClass('hidden');
  }

  hideIcon(): void {
    this.$icon.get().addClass('hidden');
  }

  updateBadge(): void {
    this.sampleFps();
    this.$info.get().html(this.getStreamInfo());
  }

  getDroppedFrames(): FrameCounters | null {
    return getFrameCounters(this.deps.videoEl());
  }

  clearSeekLabel = (): void => { this.$barSeek.get().text(''); };

  showSpinner = (): void => { this.$spinner.get().show(); };

  hideSpinner = (): void => { this.$spinner.get().hide(); };

  dispose(): void {
    this.stopProgressTimer();
    this.resetDomCache();
  }

  private startProgressTimer(): void {
    this.stopProgressTimer();
    this.progressTimer = window.setInterval(() => this.deps.updateProgress(), PROGRESS_TICK_MS);
  }

  private stopProgressTimer(): void {
    if (this.progressTimer !== null) { clearInterval(this.progressTimer); this.progressTimer = null; }
  }

  private sampleFps(): void {
    const counters = getFrameCounters(this.deps.videoEl());
    const now = Date.now();
    if (!counters) { this.prevFrames = 0; this.prevTime = 0; return; }
    if (this.prevTime > 0 && now - this.prevTime > 500) {
      const dt = (now - this.prevTime) / 1000;
      const df = counters.total - this.prevFrames;
      if (df > 0 && dt > 0) {
        this.currentFps = Math.round(df / dt);
      }
    }
    this.prevFrames = counters.total;
    this.prevTime = now;
  }

  private getStreamInfo(): string {
    const lines: string[] = [];

    // Line 1: audio + subs
    const line1: string[] = [];
    const audios = this.deps.audios();
    const sa = this.deps.selectedAudio();
    if (audios.length > 0 && sa < audios.length) {
      const a = audios[sa];
      let albl = a.lang;
      if (a.author && a.author.title) albl += ' (' + a.author.title + ')';
      albl += ' ' + a.codec + ' ' + a.channels + 'ch';
      line1.push(albl);
    }
    const subs = this.deps.subs();
    const ss = this.deps.selectedSub();
    if (ss >= 0 && ss < subs.length) {
      line1.push('Sub: ' + buildSubLabel(subs[ss], ss));
    } else {
      line1.push('Sub: Выкл');
    }
    if (line1.length > 0) lines.push(line1.join(' &bull; '));

    // Line 2: HLS + quality + codec + bitrate
    const line2: string[] = ['HLS'];
    const files = this.deps.files();
    const sq = this.deps.selectedQuality();
    if (files.length > 0 && sq < files.length) {
      const f = files[sq];
      const ql = f.quality || (f.h + 'p');
      line2.push(ql + ' ' + f.w + '×' + f.h);
      if (f.codec) line2.push(f.codec.toUpperCase());
    }
    const hls = this.deps.hlsInstance();
    if (hls) {
      const h = hls as unknown as { readonly levels?: ReadonlyArray<{ readonly bitrate?: number }>; readonly currentLevel?: number };
      const level = h.levels && h.currentLevel !== undefined && h.currentLevel >= 0
        ? h.levels[h.currentLevel]
        : undefined;
      if (level && level.bitrate) {
        line2.push((level.bitrate / 1000000).toFixed(1) + ' Mbps');
      }
    }
    lines.push(line2.join(' &bull; '));

    // Line 3: fps/Hz + dropped frames
    const counters = getFrameCounters(this.deps.videoEl());
    const line3: string[] = [];
    if (this.currentFps !== null) line3.push(this.currentFps + 'fps');
    if (counters && counters.total > 0) {
      const pct = counters.dropped > 0
        ? ' (' + (counters.dropped / counters.total * 100).toFixed(1) + '%)'
        : '';
      line3.push('dropped ' + counters.dropped + '/' + counters.total + pct);
    }
    if (line3.length > 0) lines.push(line3.join(' &bull; '));

    return lines.join('<br>');
  }
}
