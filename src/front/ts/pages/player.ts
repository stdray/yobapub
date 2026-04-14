import $ from 'jquery';
import { Page, RouteParams } from '../types/app';
import { getItem } from '../api/items';
import { markTime, toggleWatched } from '../api/watching';
import { Item, VideoFile, AudioTrack, Subtitle } from '../types/api';
import { router } from '../router';
import { TvKey, platform } from '../utils/platform';
import { storage } from '../utils/storage';
import { buildBaseHlsConfig, HlsConfig, logPlaybackStart } from '../utils/hls-proxy';
import { showHlsError } from '../utils/hls-error';
import { PageKeys, PageUtils } from '../utils/page';
import { Logger } from '../utils/log';
import { extractHostname } from '../utils/url';
import { arrayFindIndex } from '../utils/array';

const plog = new Logger('player');

interface HlsFragData {
  frag?: { sn: number; start: number; duration: number };
  stats?: { total: number; trequest: number; tfirst: number; tload: number };
}

interface HlsLevelSwitchData {
  level?: number;
  width?: number;
  height?: number;
  bitrate?: number;
  videoCodec?: string;
  audioCodec?: string;
}

interface HlsErrorData {
  fatal: boolean;
  type: string;
  details: string;
  reason?: string;
  error?: unknown;
  response?: { code: number };
  frag?: { url?: string; sn?: number; start?: number };
}

// DIAGNOSTIC: expose a global logging function so patched hls.js source files in
// node_modules (stream-controller, gap-controller, audio-stream-controller) can log
// every `media.currentTime = X` assignment via our backend-bound Logger. Tizen 2.3
// WebKit exposes currentTime as a data property, not an accessor, so we cannot
// intercept assignments via Object.defineProperty — patching the library directly
// is the only viable approach. Remove after the source of startup seeks is found.
interface CtLogWindow extends Window {
  __ctLog?: (site: string, value: number, prev: number) => void;
}
(window as CtLogWindow).__ctLog = (site: string, value: number, prev: number): void => {
  try {
    const stack = ((new Error().stack || '').split('\n').slice(1, 10).join(' | ')).substring(0, 600);
    plog.info('ctwrap site={site} value={value} prev={prev} stack={stack}', { site, value, prev, stack });
  } catch (_e) { /* never break playback on log failure */ }
};

import Hls from 'hls.js';
import { tplPlayer } from './player/template';
import {
  MediaInfo, findEpisodeMedia, findVideoMedia, loadMediaLinks,
  getResumeTime, isEpisodeWatched, isVideoWatched,
} from './player/media';
import { getRewrittenHlsUrl } from './player/hls';
import { applySubSize, changeSubSize, loadSubtitleTrack } from './player/subtitles';
import { ProgressState, getVideoDuration, updateProgress } from './player/progress';
import {
  Panel, PanelData, getAudioItems, getSubItems, getQualityItems,
} from './player/panel';
import { restoreQualityIndex, restoreAudioIndex, restoreSubIndex, saveCurrentPrefs, getTitlePrefs } from './player/preferences';
import { PlayerInfo } from './player/info';

// --- Interfaces ---

interface PlayState {
  quality: number;
  audio: number;
  sub: number;
  position: number;
  paused: boolean;
}

interface MediaContext {
  item: Item | null;
  season: number | undefined;
  episode: number | undefined;
  video: number | undefined;
  files: VideoFile[];
  audios: AudioTrack[];
  subs: Subtitle[];
  title: string;
  duration: number;
  hlsUrl: string;
}

interface SeekState {
  pos: number;
  count: number;
  dir: string;
  active: boolean;
  applyTimer: number | null;
}

// --- Defaults ---

const defaultMedia = (): MediaContext => ({
  item: null, season: undefined, episode: undefined, video: undefined,
  files: [], audios: [], subs: [], title: '', duration: 0, hlsUrl: '',
});

const defaultPlayState = (): PlayState => ({
  quality: 0, audio: 0, sub: -1, position: 0, paused: false,
});

const defaultSeekState = (): SeekState => ({
  pos: -1, count: 0, dir: '', active: false, applyTimer: null,
});

// --- PlayerController ---

class PlayerController {
  private readonly $root = $('#page-player');
  private readonly keys = new PageKeys();

  // State
  private videoEl: HTMLVideoElement | null = null;
  private hlsInstance: Hls | null = null;
  private media = defaultMedia();
  private state = defaultPlayState();
  private seek = defaultSeekState();
  private panel = this.initPanel();
  private progress: ProgressState = {
    videoEl: null, currentDuration: 0, seeking: false, seekPos: -1,
    barValueEl: null, barPctEl: null, barDurationEl: null, barSeekEl: null,
  };

  // Timers
  private markTimer: number | null = null;
  private barTimer: number | null = null;
  private progressTimer: number | null = null;
  private toastTimer: number | null = null;
  private osdTimer: number | null = null;

  // Flags
  private appendErrorCount = 0;
  private hadBufferFullError = false;
  private playbackStarted = false;
  private firstFragSnapped = false;
  private pendingStartSeek = 0;
  private markedWatched = false;
  private wasWatched = false;
  private playSourceDebug = '';

  // Info
  private readonly info = new PlayerInfo(this.$root, {
    files: () => this.media.files,
    audios: () => this.media.audios,
    subs: () => this.media.subs,
    selectedQuality: () => this.state.quality,
    selectedAudio: () => this.state.audio,
    selectedSub: () => this.state.sub,
    hlsInstance: () => this.hlsInstance,
    videoEl: () => this.videoEl,
  });

  private initPanel(): Panel {
    return new Panel(this.$root, {
      onShowInfo: () => { this.info.show(); },
      onAfterClose: () => { this.showBar(); },
      onApplyAudio: (idx) => { this.continueWith({ audio: idx }); },
      onApplySub: (menuIdx) => { this.continueWith({ sub: menuIdx - 1 }); },
      onApplyQuality: (idx) => {
        if (idx !== this.state.quality) this.continueWith({ quality: idx });
      },
      onSavePrefs: () => { this.doSavePrefs(); },
      getData: () => this.getPanelData(),
    });
  }

  // --- Helpers ---

  private syncProgress(): void {
    this.progress.videoEl = this.videoEl;
    this.progress.currentDuration = this.media.duration;
    this.progress.seeking = this.seek.active;
    this.progress.seekPos = this.seek.pos;
  }

  private updateProgressBar(): void {
    this.syncProgress();
    updateProgress(this.$root, this.progress);
  }

  private formatBuffered(v: HTMLVideoElement | null): string {
    if (!v || v.buffered.length === 0) return '[none]';
    const parts: string[] = [];
    for (let i = 0; i < v.buffered.length; i++) {
      parts.push(v.buffered.start(i).toFixed(1) + '-' + v.buffered.end(i).toFixed(1));
    }
    return parts.join(',');
  }

  private nudgePastBufferGap(): boolean {
    const v = this.videoEl;
    if (!v || v.buffered.length === 0) return false;
    const ct = v.currentTime;
    for (let i = 0; i < v.buffered.length; i++) {
      const start = v.buffered.start(i);
      if (start > ct && start - ct < 2) {
        plog.warn('nudgePastBufferGap ct={ct} -> {target}', { ct, target: start + 0.1 });
        v.currentTime = start + 0.1;
        return true;
      }
    }
    plog.warn('nudgePastBufferGap ct={ct} no suitable range found, buffered={br}', { ct, br: this.formatBuffered(v) });
    return false;
  }

  private continueWith(overrides: Partial<PlayState>): void {
    this.continuePlaying({
      quality: overrides.quality ?? this.state.quality,
      audio: overrides.audio ?? this.state.audio,
      sub: overrides.sub ?? this.state.sub,
      position: overrides.position ?? this.currentPosition(),
      paused: overrides.paused ?? this.state.paused,
    });
  }

  private sendMarkTime(): void {
    if (!this.videoEl || !this.media.item) {
      plog.warn('sendMarkTime skip hasVideo={hv} hasItem={hi}', {
        hv: !!this.videoEl, hi: !!this.media.item,
      });
      return;
    }
    const time = Math.floor(this.videoEl.currentTime);
    if (time <= 0) {
      plog.warn('sendMarkTime skip time<=0 ct={ct}', { ct: this.videoEl.currentTime });
      return;
    }
    if (this.media.season !== undefined && this.media.episode !== undefined) {
      plog.info('sendMarkTime serial id={id} season={s} episode={e} time={t}', {
        id: this.media.item.id, s: this.media.season, e: this.media.episode, t: time,
      });
      markTime(this.media.item.id, this.media.episode, time, this.media.season).then(
        () => plog.info('markTime ok id={id} time={t}', { id: this.media.item ? this.media.item.id : -1, t: time }),
        (xhr: JQueryXHR) => plog.error('markTime failed status={s} text={txt} resp={r}', {
          s: xhr ? xhr.status : -1,
          txt: xhr ? String(xhr.statusText || '') : '',
          r: xhr ? String(xhr.responseText || '').substring(0, 200) : '',
        })
      );
    } else if (this.media.video !== undefined) {
      plog.info('sendMarkTime movie id={id} video={v} time={t}', {
        id: this.media.item.id, v: this.media.video, t: time,
      });
      markTime(this.media.item.id, this.media.video, time).then(
        () => plog.info('markTime ok id={id} time={t}', { id: this.media.item ? this.media.item.id : -1, t: time }),
        (xhr: JQueryXHR) => plog.error('markTime failed status={s} text={txt} resp={r}', {
          s: xhr ? xhr.status : -1,
          txt: xhr ? String(xhr.statusText || '') : '',
          r: xhr ? String(xhr.responseText || '').substring(0, 200) : '',
        })
      );
    } else {
      plog.warn('sendMarkTime skip no season/episode/video', {});
    }
  }

  private sendToggleWatched(): void {
    if (!this.media.item) return;
    if (this.media.season !== undefined && this.media.episode !== undefined) {
      toggleWatched(this.media.item.id, this.media.episode, this.media.season);
    } else if (this.media.video !== undefined) {
      toggleWatched(this.media.item.id, this.media.video);
    }
  }

  private getPanelData(): PanelData {
    return {
      audioItems: getAudioItems(this.media.audios, this.state.audio, this.videoEl),
      subItems: getSubItems(this.media.subs, this.state.sub),
      qualityItems: getQualityItems(this.media.files, this.state.quality),
      audioEnabled: this.media.audios.length > 1 && this.media.files.length > 0,
      subsEnabled: this.media.subs.length > 0,
      qualityEnabled: this.media.files.length > 1,
    };
  }

  // --- Toast / OSD ---

  private showToast(text: string): void {
    let $toast = this.$root.find('.player__toast');
    if ($toast.length === 0) {
      this.$root.find('.player').append('<div class="player__toast"></div>');
      $toast = this.$root.find('.player__toast');
    }
    $toast.text(text).removeClass('hidden');
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { $toast.addClass('hidden'); this.toastTimer = null; }, 1500);
  }

  private showOsd(icon: 'play' | 'pause' | 'rw' | 'ff'): void {
    const symbols = { play: '▶', pause: '❚❚', rw: '◀◀', ff: '▶▶' };
    this.$root.find('.player__osd').text(symbols[icon] || icon).removeClass('hidden');
    if (this.osdTimer) clearTimeout(this.osdTimer);
    this.osdTimer = window.setTimeout(() => {
      this.$root.find('.player__osd').addClass('hidden');
      this.osdTimer = null;
    }, 700);
  }

  // --- Seek ---

  private startSeek(dir: string): void {
    this.seek.active = true;
    if (this.seek.dir !== dir) { this.seek.dir = dir; this.seek.count = 0; }
    if (this.seek.pos === -1 && this.videoEl) this.seek.pos = this.videoEl.currentTime;

    this.syncProgress();
    const step = 10 + Math.pow(Math.min(this.seek.count, 3000), 3) / 1000;
    const dur = getVideoDuration(this.progress);
    this.seek.pos += dir === 'right' ? step : -step;
    this.seek.pos = Math.max(0, dur > 0 ? Math.min(this.seek.pos, dur - 2) : this.seek.pos);
    this.seek.count++;

    if (this.seek.count === 1) {
      plog.debug('startSeek {dir} seekPos={seekPos} step={step}', { dir, seekPos: this.seek.pos, step });
    }

    this.updateProgressBar();
    this.showOsd(dir === 'right' ? 'ff' : 'rw');
    this.showBar();

    if (this.seek.applyTimer) clearTimeout(this.seek.applyTimer);
    this.seek.applyTimer = window.setTimeout(() => this.applySeek(), 2000);
  }

  private applySeek(): void {
    if (!this.seek.active || this.seek.pos < 0 || !this.videoEl) return;
    this.syncProgress();
    const dur = getVideoDuration(this.progress);
    if (dur > 0) this.seek.pos = Math.min(this.seek.pos, dur - 2);
    this.seek.pos = Math.max(0, this.seek.pos);
    const pos = this.seek.pos;
    plog.info('applySeek pos={pos} dur={dur}', { pos, dur });
    this.resetSeek();
    this.continueWith({ position: pos });
    this.showBar();
  }

  private resetSeek(): void {
    if (this.seek.applyTimer) { clearTimeout(this.seek.applyTimer); this.seek.applyTimer = null; }
    this.seek = defaultSeekState();
    this.$root.find('.player__bar-seek').text('');
  }

  // --- Track navigation ---

  private navigateEpisode(dir: number): boolean {
    const item = this.media.item;
    if (!item || !item.seasons) return false;
    const si = arrayFindIndex(item.seasons, (s) => s.number === this.media.season);
    if (si < 0) return false;
    const s = item.seasons[si];
    const ei = arrayFindIndex(s.episodes, (ep) => ep.number === this.media.episode);
    if (ei < 0) return false;

    const nextEi = ei + dir;
    if (nextEi >= 0 && nextEi < s.episodes.length) {
      this.sendMarkTime(); this.destroyPlayer();
      this.media.episode = s.episodes[nextEi].number;
      this.loadAndPlay();
      return true;
    }
    const nextSi = si + dir;
    if (nextSi >= 0 && nextSi < item.seasons.length) {
      const ns = item.seasons[nextSi];
      const ep = dir > 0 ? ns.episodes[0] : ns.episodes[ns.episodes.length - 1];
      if (ep) {
        this.sendMarkTime(); this.destroyPlayer();
        this.media.season = ns.number;
        this.media.episode = ep.number;
        this.loadAndPlay();
        return true;
      }
    }
    return false;
  }

  private navigateTrack(dir: number): boolean {
    if (!this.media.item) return false;

    if (this.media.season !== undefined && this.media.episode !== undefined) {
      return this.navigateEpisode(dir);
    } else if (this.media.video !== undefined && this.media.item.videos) {
      const newVideo = this.media.video + dir;
      if (newVideo >= 1 && newVideo <= this.media.item.videos.length) {
        this.sendMarkTime(); this.destroyPlayer();
        this.media.video = newVideo;
        this.loadAndPlay();
        return true;
      }
    }
    return false;
  }

  private loadAndPlay(): void {
    if (!this.media.item) {
      plog.error('loadAndPlay: no item — leaving spinner visible');
      return;
    }
    plog.info('loadAndPlay start season={s} episode={e} video={v} hasSeasons={hs} hasVideos={hv}', {
      s: this.media.season, e: this.media.episode, v: this.media.video,
      hs: !!this.media.item.seasons, hv: !!this.media.item.videos,
    });
    let found: MediaInfo | null = null;
    let pos = 0;

    try {
      if (this.media.season !== undefined && this.media.episode !== undefined) {
        plog.info('calling findEpisodeMedia');
        found = findEpisodeMedia(this.media.item, this.media.season, this.media.episode);
        plog.info('findEpisodeMedia ok found={f}', { f: !!found });
        pos = getResumeTime(this.media.item, this.media.season, this.media.episode);
        plog.info('getResumeTime ok pos={pos}', { pos });
        this.wasWatched = isEpisodeWatched(this.media.item, this.media.season, this.media.episode);
        plog.info('isEpisodeWatched ok');
      } else if (this.media.video !== undefined) {
        plog.info('calling findVideoMedia');
        found = findVideoMedia(this.media.item, this.media.video);
        plog.info('findVideoMedia ok found={f}', { f: !!found });
        pos = getResumeTime(this.media.item, undefined, undefined, this.media.video);
        this.wasWatched = isVideoWatched(this.media.item, this.media.video);
      }
    } catch (e) {
      const err = e as Error;
      plog.error('loadAndPlay find* threw: {msg} stack={stack}', {
        msg: err && err.message ? err.message : String(e),
        stack: err && err.stack ? err.stack.substring(0, 600) : '',
      });
      this.$root.html('<div class="player"><div class="player__title" style="padding:60px;">Ошибка разбора медиа-данных</div></div>');
      return;
    }

    if (!found) {
      plog.error('loadAndPlay: findEpisode/findVideo returned null');
      this.$root.html('<div class="player"><div class="player__title" style="padding:60px;">Видео не найдено</div></div>');
      return;
    }
    plog.info('loadAndPlay found mid={mid} title={title} audios={audios}', {
      mid: found.mid, title: found.title, audios: found.audios.length,
    });

    const itemTitle = this.media.item.title.split(' / ')[0];
    this.media.title = found.title;
    this.media.duration = found.duration;
    this.media.audios = found.audios;
    const prefs = getTitlePrefs(this.media.item.id);

    loadMediaLinks(found.mid, (files, subs) => {
      plog.info('loadMediaLinks cb files={files} subs={subs}', { files: files.length, subs: subs.length });
      this.media.files = files.slice().sort((a, b) => b.w - a.w);
      this.media.subs = subs.filter((s) => s.url && !s.embed);
      const q = restoreQualityIndex(this.media.files, prefs);
      const a = restoreAudioIndex(this.media.audios, prefs);
      const sub = restoreSubIndex(this.media.subs, prefs);

      if (this.media.files.length === 0) {
        plog.error('loadAndPlay: no files — showing Видео не найдено');
        this.$root.html('<div class="player"><div class="player__title" style="padding:60px;">Видео не найдено</div></div>');
        return;
      }
      plog.info('calling continuePlaying q={q} a={a} sub={sub} pos={pos}', { q, a, sub, pos });
      this.continuePlaying({ quality: q, audio: a, sub, position: pos, paused: false }, itemTitle + ' - ' + this.media.title);
    });
  }

  private getHlsUrl(f: VideoFile): string {
    const hls4 = (f.urls && f.urls.hls4) || (f.url && f.url.hls4) || '';
    const hls2 = (f.urls && f.urls.hls2) || (f.url && f.url.hls2) || '';
    if (platform.isLegacyTizen()) return hls2;
    const sp = storage.getStreamingType();
    if (sp === 'hls4') return hls4;
    if (sp === 'hls2') return hls2;
    return hls4 || hls2;
  }

  private currentPosition(): number {
    if (this.seek.active && this.seek.pos >= 0) return this.seek.pos;
    return this.videoEl ? this.videoEl.currentTime : 0;
  }

  private continuePlaying(next: PlayState, title?: string): void {
    const needSource = next.quality !== this.state.quality || next.audio !== this.state.audio || !this.videoEl;
    const needSub = next.sub !== this.state.sub;
    const needSeek = !needSource && Math.abs(next.position - this.currentPosition()) > 2;

    plog.info('continuePlaying {needSource} {needSeek} {needSub}', {
      needSource, needSeek, needSub,
      pos: next.position, quality: next.quality, audio: next.audio, sub: next.sub,
      paused: next.paused, hasVideo: !!this.videoEl,
    });

    this.state = { quality: next.quality, audio: next.audio, sub: next.sub, position: next.position, paused: next.paused };
    if (this.seek.active) this.resetSeek();

    if (needSource) {
      if (this.media.files.length === 0) return;
      const f = this.media.files[this.state.quality];
      const hlsUrl = this.getHlsUrl(f);
      if (!hlsUrl) return;
      if (!this.videoEl) {
        this.playUrl(hlsUrl, title || this.media.title);
      } else {
        this.showSpinner();
        this.playSource(hlsUrl);
      }
      return;
    }

    if (needSeek && this.videoEl) {
      this.videoEl.currentTime = next.position;
    }

    if (needSub && this.videoEl) {
      loadSubtitleTrack(this.videoEl, this.$root, this.media.subs, this.state.sub);
    }
  }

  // --- Bar show/hide ---

  private startProgressTimer(): void {
    this.stopProgressTimer();
    this.progressTimer = window.setInterval(() => {
      this.updateProgressBar();
    }, 1000);
  }

  private stopProgressTimer(): void {
    if (this.progressTimer !== null) { clearInterval(this.progressTimer); this.progressTimer = null; }
  }

  private showBar(): void {
    this.$root.find('.player__header, .player__gradient, .player__bar').removeClass('hidden');
    this.info.show();
    this.updateProgressBar();
    this.startProgressTimer();
    this.clearBarTimer();
    if (!this.panel.open && !this.seek.active) {
      this.barTimer = window.setTimeout(() => this.hideBar(), 4000);
    }
  }

  private hideBar(): void {
    this.stopProgressTimer();
    this.$root.find('.player__header, .player__gradient, .player__bar').addClass('hidden');
    this.info.hide();
  }

  private clearBarTimer(): void {
    if (this.barTimer !== null) { clearTimeout(this.barTimer); this.barTimer = null; }
  }

  // --- Prefs ---

  private doSavePrefs(): void {
    if (!this.media.item) return;
    saveCurrentPrefs({
      itemId: this.media.item.id,
      files: this.media.files, audios: this.media.audios, subs: this.media.subs,
      selectedQuality: this.state.quality,
      selectedAudio: this.state.audio,
      selectedSub: this.state.sub,
    });
  }

  // --- Playback ---

  private buildHlsConfig(): HlsConfig {
    const cfg = buildBaseHlsConfig();
    // Do NOT set cfg.startPosition: hls.js _seekToStartPos fires that seek during decoder
    // warmup on Tizen 2.3 WebKit, which corrupts A/V sync. We start from 0 and perform a
    // manual "user-style" seek on canplay — that path is verified to heal (see decision log
    // 2026-04-13 19:45 and 17:55). Bandwidth cost: one fragment from the beginning.
    cfg.autoStartLoad = false;
    cfg.maxBufferHole = 1.0;
    cfg.highBufferWatchdogPeriod = 10;
    cfg.nudgeMaxRetry = 3;
    cfg.abrEwmaFastLive = 5.0;
    cfg.abrEwmaSlowLive = 10.0;
    // hls.js 0.14.x uses capital-D (see node_modules/hls.js/src/config.ts).
    // Partial<Hls.Config> from @types accepts lowercase variant too — runtime would silently ignore.
    (cfg as unknown as { abrEwmaFastVoD: number }).abrEwmaFastVoD = 5.0;
    (cfg as unknown as { abrEwmaSlowVoD: number }).abrEwmaSlowVoD = 10.0;
    return cfg;
  }

  private pinQualityLevel(hls: Hls): void {
    const levels = hls.levels;
    if (!levels || levels.length <= 1) return;

    const target = this.media.files[this.state.quality];
    if (!target) return;

    let bestIdx = -1;
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].height === target.h || levels[i].width === target.w) {
        bestIdx = i;
        break;
      }
    }

    if (bestIdx >= 0) {
      hls.currentLevel = bestIdx;
      plog.info('pinQualityLevel idx={idx} target={w}x{h} level={lw}x{lh} bitrate={br}', {
        idx: bestIdx, w: target.w, h: target.h,
        lw: levels[bestIdx].width, lh: levels[bestIdx].height,
        br: levels[bestIdx].bitrate,
      });
    } else {
      plog.warn('pinQualityLevel: no matching level for {w}x{h}, levels={count}', {
        w: target.w, h: target.h, count: levels.length,
      });
    }
  }

  private playSource(originalUrl: string): void {
    if (!this.videoEl) return;
    this.media.hlsUrl = originalUrl;
    if (this.hlsInstance) { this.hlsInstance.destroy(); this.hlsInstance = null; }
    this.firstFragSnapped = false;
    this.pendingStartSeek = this.state.position > 0 ? this.state.position : 0;
    this.playSourceDebug = 'url=' + originalUrl.substring(0, 120);
    plog.newTraceId();
    const cfg = this.buildHlsConfig();
    logPlaybackStart(plog, originalUrl, {
      startPosition: cfg.startPosition || 0,
      quality: this.state.quality,
      audio: this.state.audio,
      sub: this.state.sub,
    });
    const audioIndex = this.media.audios.length > 0 ? this.media.audios[this.state.audio].index : 1;
    const url = getRewrittenHlsUrl(originalUrl, audioIndex);
    const hls = new Hls(cfg);
    this.hlsInstance = hls;
    hls.on(Hls.Events.FRAG_LOADING, (_e: string, data: { frag?: { sn: number; start: number; duration: number } }) => {
      const frag = data.frag;
      if (frag) {
        plog.debug('hls FRAG_LOADING sn={sn} start={start} dur={dur}', {
          sn: frag.sn, start: frag.start, dur: frag.duration,
        });
      }
    });
    hls.on(Hls.Events.FRAG_LOADED, (_e: string, data: HlsFragData) => {
      const frag = data.frag;
      const stats = data.stats;
      if (frag && stats) {
        const loadMs = stats.tload - stats.trequest;
        const sizeKb = (stats.total / 1024).toFixed(0);
        plog.info('hls FRAG_LOADED sn={sn} start={start} dur={dur} size={size}KB load={load}ms', {
          sn: frag.sn, start: frag.start, dur: frag.duration,
          size: sizeKb, load: loadMs,
        });
      }
    });
    hls.on(Hls.Events.FRAG_BUFFERED, (_e: string, data: { frag?: { sn: number; start: number; type?: string } }) => {
      const frag = data.frag;
      if (!frag) return;
      const v = this.videoEl;
      plog.info('hls FRAG_BUFFERED sn={sn} start={start} type={type} started={started} ct={ct} br={br}', {
        sn: frag.sn, start: frag.start, type: frag.type || null,
        started: this.playbackStarted,
        ct: v ? v.currentTime : -1,
        br: this.formatBuffered(v),
      });
      // Resume: apply pending start seek only once real data is in SourceBuffer so the
      // assignment causes hls.js to stopLoad+startLoad+flush and fetch the target fragment
      // from scratch (decoder-reset path). Seeking before the buffer is populated is
      // indistinguishable from hls.js _seekToStartPos and triggers the Tizen 2.3 A/V desync.
      if (this.pendingStartSeek > 0 && v && v.buffered.length > 0) {
        const target = this.pendingStartSeek;
        this.pendingStartSeek = 0;
        this.firstFragSnapped = true;
        plog.info('startSeek target={target} from ct={ct} br={br}', {
          target, ct: v.currentTime, br: this.formatBuffered(v),
        });
        v.currentTime = target;
      }
    });
    hls.on(Hls.Events.LEVEL_SWITCHING, (_e: string, data: HlsLevelSwitchData) => {
      plog.info('hls LEVEL_SWITCHING level={level} {w}x{h} bitrate={br} videoCodec={vc} audioCodec={ac}', {
        level: data.level, w: data.width, h: data.height,
        br: data.bitrate, vc: data.videoCodec || null, ac: data.audioCodec || null,
      });
    });
    hls.on(Hls.Events.LEVEL_SWITCHED, (_e: string, data: { level?: number }) => {
      const lvl = data.level !== undefined ? hls.levels[data.level] : undefined;
      plog.info('hls LEVEL_SWITCHED level={level} {w}x{h} bitrate={br} videoCodec={vc} audioCodec={ac}', {
        level: data.level,
        w: lvl ? lvl.width : null, h: lvl ? lvl.height : null,
        br: lvl ? lvl.bitrate : null, vc: lvl ? lvl.videoCodec || null : null, ac: lvl ? lvl.audioCodec || null : null,
      });
    });
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      const lvls = hls.levels;
      plog.info('hls MANIFEST_PARSED levels={count} details={details}', {
        count: lvls.length,
        details: lvls.map((l) =>
          l.width + 'x' + l.height + '@' + l.bitrate
          + ' vc=' + (l.videoCodec || '?') + ' ac=' + (l.audioCodec || '?'),
        ).join(', '),
      });
      this.pinQualityLevel(hls);
      // autoStartLoad is disabled in config — start loading only after pin to avoid
      // hls.js kicking off a load on level 0/auto and then switching (double LEVEL_SWITCHING).
      // Always load from the beginning; real start position is applied as a runtime seek in canplay.
      hls.startLoad(0);
      this.onSourceReady();
    });
    hls.on(Hls.Events.ERROR, (_e: string, data: HlsErrorData) => {
      if (!data.fatal) {
        plog.warn('hls error (non-fatal) {type} {details} {reason} {error} {fragUrl}', {
          type: data.type, details: data.details,
          reason: data.reason || null,
          error: data.error ? String(data.error).substring(0, 200) : null,
          fragUrl: data.frag ? (data.frag.url || '').substring(0, 120) : null,
          fragSn: data.frag ? data.frag.sn : null,
          fragStart: data.frag ? data.frag.start : null,
        });
        const v = this.videoEl;
        const diag = {
          started: this.playbackStarted,
          ct: v ? v.currentTime : -1,
          rs: v ? v.readyState : -1,
          paused: v ? v.paused : null,
          br: this.formatBuffered(v),
        };
        if (data.details === 'bufferFullError') {
          this.hadBufferFullError = true;
          plog.warn('hls bufferFullError flagged started={started} ct={ct} rs={rs} br={br}', diag);
        }
        if (data.details === 'bufferAppendingError') {
          this.appendErrorCount++;
          plog.warn('hls bufferAppendingError count={count} hadFull={hadFull} started={started} ct={ct} rs={rs} br={br}', {
            count: this.appendErrorCount,
            hadFull: this.hadBufferFullError,
            started: diag.started, ct: diag.ct, rs: diag.rs, paused: diag.paused, br: diag.br,
          });
          if (this.appendErrorCount >= 2 || this.hadBufferFullError) {
            plog.warn('hls RECOVER via bufferAppendingError started={started} ct={ct} rs={rs} br={br}', diag);
            hls.recoverMediaError();
            if (this.videoEl) this.videoEl.play();
            this.appendErrorCount = 0;
            this.hadBufferFullError = false;
          }
        }
        if (data.details === 'bufferStalledError') {
          plog.warn('hls bufferStalledError hadFull={hadFull} started={started} ct={ct} rs={rs} br={br}', {
            hadFull: this.hadBufferFullError,
            started: diag.started, ct: diag.ct, rs: diag.rs, paused: diag.paused, br: diag.br,
          });
          if (!this.nudgePastBufferGap() && this.hadBufferFullError) {
            plog.warn('hls RECOVER via bufferStalledError started={started} ct={ct} rs={rs} br={br}', diag);
            hls.recoverMediaError();
            if (this.videoEl) this.videoEl.play();
            this.hadBufferFullError = false;
            this.appendErrorCount = 0;
          }
        }
        return;
      }
      const hlsFatalLvl = (hls as unknown as { readonly currentLevel?: number }).currentLevel;
      plog.error('hls fatal {type} {details} {status} currentLevel={currentLevel}', {
        type: data.type, details: data.details,
        status: data.response ? data.response.code : null,
        currentLevel: hlsFatalLvl !== undefined ? hlsFatalLvl : null,
        reason: data.reason || null,
        error: data.error ? String(data.error).substring(0, 200) : null,
      });
      // Unrecoverable MEDIA_ERROR details — manifest-level codec mismatches cannot be
      // fixed by recoverMediaError(), which only handles decoder/buffer issues at runtime.
      // Calling recover here would just leave the spinner spinning forever.
      const unrecoverableMediaErrors: ReadonlyArray<string> = [
        'manifestIncompatibleCodecsError',
        'manifestParsingError',
        'levelEmptyError',
      ];
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && unrecoverableMediaErrors.indexOf(data.details) < 0) {
        const vf = this.videoEl;
        plog.warn('hls RECOVER fatal MEDIA_ERROR started={started} ct={ct} rs={rs} br={br}', {
          started: this.playbackStarted,
          ct: vf ? vf.currentTime : -1,
          rs: vf ? vf.readyState : -1,
          br: this.formatBuffered(vf),
        });
        hls.recoverMediaError();
        return;
      }
      this.destroyPlayer();
      showHlsError(plog, this.$root, data, 'player');
      this.keys.unbind();
      this.keys.bind((e: JQuery.Event) => {
        const kc = this.getKeyCode(e);
        if (kc === TvKey.Return || kc === TvKey.Backspace || kc === TvKey.Escape) {
          router.goBack();
          e.preventDefault();
        }
      });
    });
    hls.loadSource(url);
    hls.attachMedia(this.videoEl);
  }

  private onSourceReady(): void {
    if (!this.videoEl) return;
    plog.info('onSourceReady pos={pos} paused={paused} ct={ct}', {
      pos: this.state.position, paused: this.state.paused, ct: this.videoEl.currentTime,
    });
    if (!this.state.paused) this.videoEl.play();
    this.playbackStarted = true;
    if (this.state.sub >= 0 && this.videoEl) {
      loadSubtitleTrack(this.videoEl, this.$root, this.media.subs, this.state.sub);
    }
    this.hideSpinner();
    this.startMarkTimer();
    this.showBar();
    this.info.updateBadge();
  }

  private showSpinner(): void {
    this.$root.find('.player__spinner').show();
  }

  private hideSpinner(): void {
    this.$root.find('.player__spinner').hide();
  }

  private getHlsDomain(): string {
    return extractHostname(this.media.hlsUrl);
  }

  private getCurrentHlsLevel(): Hls.Level | undefined {
    const h = this.hlsInstance;
    if (!h || h.currentLevel < 0 || !h.levels) return undefined;
    return h.levels[h.currentLevel];
  }

  private getVideoErrorMessage(error: MediaError | null): string {
    if (!error) return 'Неизвестная ошибка воспроизведения';
    switch (error.code) {
      case MediaError.MEDIA_ERR_ABORTED:
        return 'Воспроизведение прервано';
      case MediaError.MEDIA_ERR_NETWORK:
        return 'Ошибка сети при загрузке видео';
      case MediaError.MEDIA_ERR_DECODE:
        return 'Ошибка декодирования видео (формат не поддерживается устройством)';
      case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
        return 'Формат видео не поддерживается (Tizen 2.3 не может воспроизвести этот поток)';
      default:
        return 'Ошибка воспроизведения (код: ' + error.code + ')';
    }
  }

  private showPlaybackError(error: MediaError | null, url: string): void {
    const msg = this.getVideoErrorMessage(error);
    const code = error ? error.code : 0;
    const detail = error && (error as { message?: string }).message ? (error as { message?: string }).message : '';
    const domain = this.getHlsDomain();
    const curLevel = this.getCurrentHlsLevel();
    const devInfo = platform.getDeviceInfo();
    plog.error('playbackError {code} {msg} {detail} {domain} hlsLevel={hlsLevel} hlsRes={hlsRes} videoCodec={vc} audioCodec={ac}', {
      code, msg, detail: detail || null, domain,
      url: url.substring(0, 120), ua: navigator.userAgent,
      hw: devInfo.hardware, sw: devInfo.software,
      hlsLevel: this.hlsInstance ? this.hlsInstance.currentLevel : null,
      hlsRes: curLevel ? curLevel.width + 'x' + curLevel.height : null,
      vc: curLevel ? curLevel.videoCodec || null : null,
      ac: curLevel ? curLevel.audioCodec || null : null,
    });
    this.destroyPlayer();
    this.$root.html(
      '<div class="player">' +
        '<div class="player__title" style="padding:60px;">' +
          '<div>' + msg + '</div>' +
          (domain ? '<div class="player__error-debug">' + domain + '</div>' : '') +
          '<div class="player__error-debug">Код ошибки: ' + code + '</div>' +
          '<div class="player__error-debug">' + navigator.userAgent + '</div>' +
        '</div>' +
      '</div>'
    );
    this.keys.unbind();
    this.keys.bind((e: JQuery.Event) => {
      const kc = this.getKeyCode(e);
      if (kc === TvKey.Return || kc === TvKey.Backspace || kc === TvKey.Escape) {
        router.goBack();
        e.preventDefault();
      }
    });
  }

  private playUrl(url: string, title: string): void {
    const itemTitle = title.split(' - ')[0] || title;
    const epTitle = title.indexOf(' - ') >= 0 ? title.substring(title.indexOf(' - ') + 3) : '';
    this.$root.html(tplPlayer({ title: itemTitle, episode: epTitle }));
    this.videoEl = this.$root.find('video')[0] as HTMLVideoElement;
    this.progress.barValueEl = null;
    this.progress.barPctEl = null;
    this.progress.barDurationEl = null;
    this.progress.barSeekEl = null;

    const sourceUrl = url;
    this.videoEl.addEventListener('ended', () => {
      plog.info('video ended currentTime={currentTime}', { currentTime: this.videoEl ? this.videoEl.currentTime : -1 });
      if (!this.markedWatched) this.sendToggleWatched();
      if (!this.navigateTrack(1)) router.goBack();
    });
    this.videoEl.addEventListener('waiting', () => {
      plog.debug('video waiting currentTime={currentTime}', { currentTime: this.videoEl ? this.videoEl.currentTime : -1 });
      this.showSpinner();
    });
    this.videoEl.addEventListener('seeking', () => {
      const v = this.videoEl;
      plog.debug('video seeking currentTime={currentTime}', { currentTime: v ? v.currentTime : -1 });
      // Tizen 2.3: hls.js seeks to startPosition but float drift lands ct just before buffered.start(0).
      // Gap-controller then nudges by 0.1, causing a second seek mid-playback that desyncs audio.
      // One-shot correction: on the first startup seek that lands strictly before the buffered range, snap inside.
      if (!this.firstFragSnapped && v && v.buffered.length > 0) {
        const bStart = v.buffered.start(0);
        if (v.currentTime < bStart && bStart - v.currentTime < 1) {
          this.firstFragSnapped = true;
          const target = bStart + 0.05;
          plog.info('startupSeekSnap ct={ct} bStart={bStart} -> {target}', {
            ct: v.currentTime, bStart, target,
          });
          v.currentTime = target;
        }
      }
    });
    this.videoEl.addEventListener('canplay', () => {
      const v = this.videoEl;
      plog.debug('video canplay currentTime={currentTime}', { currentTime: v ? v.currentTime : -1 });
      this.hideSpinner();
      if (!v) return;
      // Fresh playback (pos=0): some HLS streams have first-segment PTS != 0, leaving the
      // SourceBuffer starting at e.g. 10.0 while playhead sits at 0. Gap-controller won't
      // close gaps > maxBufferHole. Snap once to the buffered start so playback can begin.
      // Resume (pendingStartSeek > 0) is handled in FRAG_BUFFERED, not here.
      if (this.pendingStartSeek === 0 && !this.firstFragSnapped && v.buffered.length > 0 && v.currentTime < v.buffered.start(0)) {
        const target = v.buffered.start(0) + 0.05;
        this.firstFragSnapped = true;
        plog.info('startSeek pts-snap target={target} from ct={ct} br={br}', {
          target, ct: v.currentTime, br: this.formatBuffered(v),
        });
        v.currentTime = target;
      }
    });
    this.videoEl.addEventListener('playing', () => {
      this.appendErrorCount = 0;
      this.hadBufferFullError = false;
      plog.info('video playing ct={ct} readyState={rs} buffered={br}', {
        ct: this.videoEl ? this.videoEl.currentTime : -1,
        rs: this.videoEl ? this.videoEl.readyState : -1,
        br: this.formatBuffered(this.videoEl),
      });
      this.hideSpinner();
    });
    this.videoEl.addEventListener('seeked', () => {
      plog.debug('video seeked ct={ct} readyState={rs} buffered={br}', {
        ct: this.videoEl ? this.videoEl.currentTime : -1,
        rs: this.videoEl ? this.videoEl.readyState : -1,
        br: this.formatBuffered(this.videoEl),
      });
      this.hideSpinner();
    });
    this.videoEl.addEventListener('error', () => {
      const v = this.videoEl;
      const err2 = v ? v.error : null;
      const curLevel = this.getCurrentHlsLevel();
      plog.error('video error code={code} message={message} ct={ct} readyState={rs}'
        + ' buffered={br} hlsLevel={hlsLevel} videoCodec={vc} audioCodec={ac} hlsBitrate={hlsBitrate}', {
        code: err2 ? err2.code : null,
        message: err2 ? (err2 as { message?: string }).message || null : null,
        ct: v ? v.currentTime : null,
        rs: v ? v.readyState : null,
        br: this.formatBuffered(v || null),
        hlsLevel: this.hlsInstance ? this.hlsInstance.currentLevel : null,
        vc: curLevel ? curLevel.videoCodec || null : null,
        ac: curLevel ? curLevel.audioCodec || null : null,
        hlsBitrate: curLevel ? curLevel.bitrate : null,
      });
      if ((this.appendErrorCount > 0 || this.hadBufferFullError) && this.hlsInstance) {
        plog.warn('video error during buffer recovery, attempting recoverMediaError instead of destroying');
        this.hlsInstance.recoverMediaError();
        if (v) v.play();
        this.appendErrorCount = 0;
        this.hadBufferFullError = false;
        return;
      }
      if (v) this.showPlaybackError(v.error, sourceUrl);
    });

    applySubSize();
    this.playSource(url);
  }

  // --- Mark time ---

  private startMarkTimer(): void {
    this.stopMarkTimer();
    this.markedWatched = false;
    plog.info('startMarkTimer interval=30000', {});
    this.markTimer = window.setInterval(() => {
      plog.info('markTimer tick', {});
      this.sendMarkTime();
      this.logPlaybackQuality();
      if (this.wasWatched) {
        this.wasWatched = false;
        plog.info('resetting watched status after 30s of playback');
        this.sendToggleWatched();
      }
      if (!this.markedWatched) {
        this.syncProgress();
        const dur = getVideoDuration(this.progress);
        if (dur > 0) {
          const time = this.videoEl ? Math.floor(this.videoEl.currentTime) : 0;
          const threshold = this.media.season !== undefined ? 120 : 420;
          if (dur - time <= threshold) {
            this.markedWatched = true;
            this.sendToggleWatched();
          }
        }
      }
    }, 30000);
  }

  private logPlaybackQuality(): void {
    const q = this.info.getDroppedFrames();
    if (!q || q.total === 0) return;
    const pct = (q.dropped / q.total * 100).toFixed(1);
    plog.info('playbackQuality total={total} dropped={dropped} ({pct}%)', {
      total: q.total, dropped: q.dropped, pct,
    });
  }

  private stopMarkTimer(): void {
    if (this.markTimer !== null) {
      plog.info('stopMarkTimer', {});
      clearInterval(this.markTimer);
      this.markTimer = null;
    }
  }

  private destroyPlayer(): void {
    this.sendMarkTime();
    this.stopMarkTimer();
    this.stopProgressTimer();
    this.clearBarTimer();
    this.panel.clearIdle();
    this.resetSeek();
    if (this.osdTimer) { clearTimeout(this.osdTimer); this.osdTimer = null; }
    if (this.hlsInstance) { this.hlsInstance.destroy(); this.hlsInstance = null; }
    if (this.videoEl) {
      try { this.videoEl.pause(); } catch { /* ignore */ }
      this.videoEl.removeAttribute('src');
      try { this.videoEl.load(); } catch { /* ignore */ }
      this.videoEl = null;
    }
    this.progress.barValueEl = null;
    this.progress.barPctEl = null;
    this.progress.barDurationEl = null;
    this.progress.barSeekEl = null;
    this.media.hlsUrl = '';
  }

  private resetState(): void {
    this.media = defaultMedia();
    this.state = defaultPlayState();
    this.seek = defaultSeekState();
    this.panel = this.initPanel();
    this.progress = {
      videoEl: null, currentDuration: 0, seeking: false, seekPos: -1,
      barValueEl: null, barPctEl: null, barDurationEl: null, barSeekEl: null,
    };
    this.playbackStarted = false;
    this.markedWatched = false;
    this.wasWatched = false;
    this.playSourceDebug = '';
  }

  // --- Keys ---

  private getKeyCode(e: JQuery.Event): number {
    const orig = (e as { originalEvent?: KeyboardEvent }).originalEvent;
    return (orig && orig.keyCode) ? orig.keyCode : (e.keyCode || 0);
  }

  private readonly handleKey = (e: JQuery.Event): void => {
    const kc = this.getKeyCode(e);
    if (!this.videoEl) {
      if (kc === TvKey.Return || kc === TvKey.Backspace || kc === TvKey.Escape || kc === TvKey.Stop) {
        this.destroyPlayer(); router.goBack(); e.preventDefault();
      }
      return;
    }

    if (this.panel.open) {
      this.panel.handleKey(e, kc);
      return;
    }

    switch (kc) {
      case TvKey.Return: case TvKey.Backspace: case TvKey.Escape: case TvKey.Stop:
        this.destroyPlayer(); router.goBack(); break;

      case TvKey.Enter: case TvKey.PlayPause:
        if (!this.playbackStarted) break;
        if (this.videoEl.paused) {
          plog.info('key Enter/PlayPause paused → play (was paused={paused} videoElPaused={vp})', {
            paused: this.state.paused, vp: this.videoEl.paused,
          });
          this.videoEl.play(); this.state.paused = false; this.showOsd('play');
        } else {
          plog.info('key Enter/PlayPause play → paused (was paused={paused} videoElPaused={vp})', {
            paused: this.state.paused, vp: this.videoEl.paused,
          });
          this.videoEl.pause(); this.state.paused = true; this.showOsd('pause');
        }
        this.showBar(); break;

      case TvKey.Play:
        plog.info('key Play (was paused={paused} videoElPaused={vp})', { paused: this.state.paused, vp: this.videoEl.paused });
        if (this.videoEl.paused) { this.videoEl.play(); this.state.paused = false; this.showOsd('play'); this.showBar(); }
        break;
      case TvKey.Pause:
        plog.info('key Pause (was paused={paused} videoElPaused={vp})', { paused: this.state.paused, vp: this.videoEl.paused });
        this.videoEl.pause(); this.state.paused = true; this.showOsd('pause'); this.showBar(); break;

      case TvKey.Left: case TvKey.Rw:
        this.startSeek('left'); break;
      case TvKey.Right: case TvKey.Ff:
        this.startSeek('right'); break;

      case TvKey.TrackNext:
        this.navigateTrack(1); break;
      case TvKey.TrackPrev:
        this.navigateTrack(-1); break;

      case TvKey.Up:
        this.showBar(); break;
      case TvKey.Down:
        this.panel.show(); break;

      case TvKey.Green:
        changeSubSize(1, (text) => this.showToast(text)); break;
      case TvKey.Red:
        changeSubSize(-1, (text) => this.showToast(text)); break;
    }
    e.preventDefault();
  };

  // --- Page lifecycle ---

  mount(params: RouteParams): void {
    this.resetState();
    this.media.season = params.season;
    this.media.episode = params.episode;
    this.media.video = params.video;

    PageUtils.showSpinnerIn(this.$root);
    const id = params.id!;
    plog.info('mount start id={id} season={s} episode={e} video={v}', {
      id, s: params.season, e: params.episode, v: params.video,
    });

    getItem(id).then(
      (itemRes: { item: Item }) => {
        try {
          const data = Array.isArray(itemRes) ? itemRes[0] : itemRes;
          this.media.item = data.item;
          plog.info('mount getItem ok hasItem={hasItem} title={title}', {
            hasItem: !!this.media.item,
            title: this.media.item ? this.media.item.title : null,
          });
          if (!this.media.item) {
            plog.error('mount getItem returned no item — leaving spinner visible');
            return;
          }
          this.loadAndPlay();
        } catch (e) {
          const err = e as Error;
          plog.error('mount handler threw: {msg} stack={stack}', {
            msg: err && err.message ? err.message : String(e),
            stack: err && err.stack ? err.stack.substring(0, 600) : '',
          });
          this.$root.html('<div class="player"><div class="player__title" style="padding:60px;">Ошибка инициализации плеера</div></div>');
        }
      },
      (xhr: JQueryXHR) => {
        plog.error('mount getItem failed status={status} text={text} resp={resp}', {
          status: xhr ? xhr.status : -1,
          text: xhr ? String(xhr.statusText || '') : '',
          resp: xhr ? String(xhr.responseText || '').substring(0, 200) : '',
        });
        this.$root.html('<div class="player"><div class="player__title" style="padding:60px;">Ошибка загрузки</div></div>');
      }
    );

    this.keys.bind(this.handleKey);
  }

  unmount(): void {
    this.destroyPlayer();
    this.keys.unbind();
    PageUtils.clearPage(this.$root);
  }
}

// --- Export ---

const controller = new PlayerController();

export const playerPage: Page = {
  mount: (params) => controller.mount(params),
  unmount: () => controller.unmount(),
};
