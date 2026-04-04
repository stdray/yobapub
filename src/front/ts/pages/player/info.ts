import $ from 'jquery';
import { VideoFile, AudioTrack, Subtitle } from '../../types/api';
import Hls from 'hls.js';

interface VideoPlaybackQuality {
  readonly totalVideoFrames: number;
  readonly droppedVideoFrames: number;
}

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

let measuredRefreshRate: number | null = null;

const measureRefreshRate = (): void => {
  if (measuredRefreshRate !== null) return;
  let prev = 0;
  let count = 0;
  let sum = 0;
  const SAMPLES = 10;
  const tick = (ts: number): void => {
    if (prev > 0) {
      sum += ts - prev;
      count++;
    }
    prev = ts;
    if (count < SAMPLES) {
      requestAnimationFrame(tick);
    } else {
      measuredRefreshRate = Math.round(1000 / (sum / count));
    }
  };
  requestAnimationFrame(tick);
};

const getVideoFps = (videoEl: HTMLVideoElement | null, quality: VideoPlaybackQuality | null): number | null => {
  if (!videoEl || !quality || quality.totalVideoFrames === 0) return null;
  const ct = videoEl.currentTime;
  if (ct <= 1) return null;
  return Math.round(quality.totalVideoFrames / ct);
};

const getPlaybackQuality = (videoEl: HTMLVideoElement | null): VideoPlaybackQuality | null => {
  if (!videoEl) return null;
  const fn = (videoEl as unknown as { readonly getVideoPlaybackQuality?: () => VideoPlaybackQuality }).getVideoPlaybackQuality;
  if (typeof fn !== 'function') return null;
  return fn.call(videoEl);
};

export class PlayerInfo {
  private readonly $root: JQuery;
  private readonly src: InfoDataSource;

  constructor($root: JQuery, src: InfoDataSource) {
    this.$root = $root;
    this.src = src;
    measureRefreshRate();
  }

  show(): void {
    this.updateBadge();
    this.$root.find('.player__info').removeClass('hidden');
  }

  hide(): void {
    this.$root.find('.player__info').addClass('hidden');
  }

  updateBadge(): void {
    this.$root.find('.player__info').html(this.getStreamInfo());
  }

  getDroppedFrames(): VideoPlaybackQuality | null {
    return getPlaybackQuality(this.src.videoEl());
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
    const videoEl = this.src.videoEl();
    const quality = getPlaybackQuality(videoEl);
    const line3: string[] = [];
    const fpsParts: string[] = [];
    const videoFps = getVideoFps(videoEl, quality);
    if (videoFps !== null) fpsParts.push(videoFps + 'fps');
    if (measuredRefreshRate !== null) fpsParts.push(measuredRefreshRate + 'Hz');
    if (fpsParts.length > 0) line3.push(fpsParts.join('/'));
    if (quality && quality.totalVideoFrames > 0) {
      const pct = quality.droppedVideoFrames > 0
        ? ' (' + (quality.droppedVideoFrames / quality.totalVideoFrames * 100).toFixed(1) + '%)'
        : '';
      line3.push('dropped ' + quality.droppedVideoFrames + '/' + quality.totalVideoFrames + pct);
    }
    if (line3.length > 0) lines.push(line3.join(' &bull; '));

    return lines.join('<br>');
  }
}
