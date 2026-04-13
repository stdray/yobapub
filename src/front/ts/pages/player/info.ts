import { VideoFile, AudioTrack, Subtitle } from '../../types/api';
import Hls from 'hls.js';

export interface InfoDataSource {
  readonly files: () => ReadonlyArray<VideoFile>;
  readonly audios: () => ReadonlyArray<AudioTrack>;
  readonly subs: () => ReadonlyArray<Subtitle>;
  readonly selectedQuality: () => number;
  readonly selectedAudio: () => number;
  readonly selectedSub: () => number;
  readonly hlsInstance: () => Hls | null;
  readonly videoEl: () => HTMLVideoElement | null;
}


// --- Frame counters ---

interface FrameCounters {
  readonly total: number;
  readonly dropped: number;
}

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

// --- PlayerInfo ---

export class PlayerInfo {
  private readonly $root: JQuery;
  private readonly src: InfoDataSource;
  private prevFrames = 0;
  private prevTime = 0;
  private currentFps: number | null = null;

  constructor($root: JQuery, src: InfoDataSource) {
    this.$root = $root;
    this.src = src;
  }

  show(): void {
    this.updateBadge();
    this.$root.find('.player__info').removeClass('hidden');
  }

  hide(): void {
    this.$root.find('.player__info').addClass('hidden');
  }

  updateBadge(): void {
    this.sampleFps();
    this.$root.find('.player__info').html(this.getStreamInfo());
  }

  getDroppedFrames(): FrameCounters | null {
    return getFrameCounters(this.src.videoEl());
  }

  private sampleFps(): void {
    const counters = getFrameCounters(this.src.videoEl());
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
    const audios = this.src.audios();
    const sa = this.src.selectedAudio();
    if (audios.length > 0 && sa < audios.length) {
      const a = audios[sa];
      let albl = a.lang;
      if (a.author && a.author.title) albl += ' (' + a.author.title + ')';
      albl += ' ' + a.codec + ' ' + a.channels + 'ch';
      line1.push(albl);
    }
    const subs = this.src.subs();
    const ss = this.src.selectedSub();
    if (ss >= 0 && ss < subs.length) {
      line1.push('Sub: ' + subs[ss].lang.toUpperCase());
    } else {
      line1.push('Sub: \u0412\u044b\u043a\u043b');
    }
    if (line1.length > 0) lines.push(line1.join(' &bull; '));

    // Line 2: HLS + quality + codec + bitrate
    const line2: string[] = ['HLS'];
    const files = this.src.files();
    const sq = this.src.selectedQuality();
    if (files.length > 0 && sq < files.length) {
      const f = files[sq];
      const ql = f.quality || (f.h + 'p');
      line2.push(ql + ' ' + f.w + '\u00d7' + f.h);
      if (f.codec) line2.push(f.codec.toUpperCase());
    }
    const hls = this.src.hlsInstance();
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
    const counters = getFrameCounters(this.src.videoEl());
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
