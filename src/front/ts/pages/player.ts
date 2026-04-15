import $ from 'jquery';
import { Page, RouteParams } from '../types/app';
import { loadItemWithWatching } from '../api/items';
import { Item, VideoFile, AudioTrack, Subtitle, WatchingInfoItem } from '../types/api';
import { router } from '../router';
import { TvKey } from '../utils/platform';
import { PageKeys, PageUtils } from '../utils/page';
import { Logger } from '../utils/log';
import { pickHlsUrl } from '../utils/hls-utils';

import { tplPlayer } from './player/template';
import {
  MediaInfo, findEpisodeMedia, findVideoMedia, loadMediaLinks,
  getResumeTime, isEpisodeWatched, isVideoWatched,
} from './player/media';
import { applySubSize, loadSubtitleTrack } from './player/subtitles';
import { storage } from '../utils/storage';
import { HlsEngine, HlsFatalErrorData } from './player/hls-engine';
import { TrackNavigator } from './player/track-navigator';
import { PlayerErrorView } from './player/error-view';
import { ProgressBar } from './player/progress';
import {
  Panel, PanelData, getAudioItems, getSubItems, getQualityItems, getSubSizeItems,
} from './player/panel';
import { restoreQualityIndex, restoreAudioIndex, restoreSubIndex, saveCurrentPrefs, getTitlePrefs } from './player/preferences';
import { PlayerInfo } from './player/info';
import { SeekController, SeekDirection } from './player/seek';
import { WatchProgressTracker } from './player/watch-tracker';
import { OverlayView } from './player/overlay';
import { installCtLogShim } from './player/ct-debug';
import { bindVideoEvents, VideoBindingsDeps } from './player/video-bindings';

const plog = new Logger('player');

installCtLogShim(plog);

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
  watching: WatchingInfoItem | null;
  season: number | undefined;
  episode: number | undefined;
  video: number | undefined;
  files: VideoFile[];
  audios: AudioTrack[];
  subs: Subtitle[];
  title: string;
  duration: number;
}

// --- Defaults ---

const defaultMedia = (): MediaContext => ({
  item: null, watching: null, season: undefined, episode: undefined, video: undefined,
  files: [], audios: [], subs: [], title: '', duration: 0,
});

const defaultPlayState = (): PlayState => ({
  quality: 0, audio: 0, sub: -1, position: 0, paused: false,
});

// --- PlayerController ---

class PlayerController {
  private readonly $root = $('#page-player');
  private readonly keys = new PageKeys();

  // State
  private videoEl: HTMLVideoElement | null = null;
  private media = defaultMedia();
  private state = defaultPlayState();
  private readonly engine = new HlsEngine({
    getVideoEl: () => this.videoEl,
    getPlaybackStarted: () => this.playbackStarted,
    onReady: () => this.onSourceReady(),
    onFatalError: (data: HlsFatalErrorData) => this.errorView.showHlsFatalError(data),
    log: plog,
  });
  private readonly errorView = new PlayerErrorView({
    $root: this.$root,
    keys: this.keys,
    engine: this.engine,
    onDestroy: () => this.destroyPlayer(),
    log: plog,
  });
  private readonly trackNavigator = new TrackNavigator({
    getItem: () => this.media.item,
    getSeason: () => this.media.season,
    getEpisode: () => this.media.episode,
    getVideo: () => this.media.video,
    setSeasonEpisode: (season, episode) => { this.media.season = season; this.media.episode = episode; },
    setVideo: (video) => { this.media.video = video; },
    onBeforeSwitch: () => { this.watchTracker.sendMarkTime(); this.destroyPlayer(); },
    onAfterSwitch: () => { this.loadAndPlay(); },
  });
  private readonly info = new PlayerInfo(this.$root, {
    files: () => this.media.files,
    audios: () => this.media.audios,
    subs: () => this.media.subs,
    selectedQuality: () => this.state.quality,
    selectedAudio: () => this.state.audio,
    selectedSub: () => this.state.sub,
    hlsInstance: () => this.engine.instance,
    videoEl: () => this.videoEl,
  });
  private readonly progressBar: ProgressBar = new ProgressBar({
    $root: this.$root,
    getVideoEl: () => this.videoEl,
    getDurationHint: () => this.media.duration,
    getSeekActive: () => this.seek.active,
    getSeekPos: () => this.seek.position,
  });
  private readonly seek: SeekController = new SeekController({
    getVideoEl: () => this.videoEl,
    getDuration: () => this.progressBar.getDuration(),
    onTick: (dir: SeekDirection) => {
      this.progressBar.update();
      this.overlay.showOsd(dir === 'right' ? 'ff' : 'rw');
      this.overlay.showBar();
    },
    onApply: (pos: number) => { this.continueWith({ position: pos }); this.overlay.showBar(); },
    log: plog,
  });
  private readonly overlay = new OverlayView({
    $root: this.$root,
    info: this.info,
    updateProgress: () => this.progressBar.update(),
    canAutoHide: () => !this.panel.focused && !this.seek.active,
  });
  private readonly panel = new Panel(this.$root, {
    onAfterClose: () => { this.overlay.hideBar(); },
    onApplyAudio: (idx) => { this.continueWith({ audio: idx }); },
    onApplySub: (menuIdx) => { this.continueWith({ sub: menuIdx - 1 }); },
    onApplyQuality: (idx) => {
      if (idx !== this.state.quality) this.continueWith({ quality: idx });
    },
    onApplySubSize: (size) => { storage.setSubSize(size); applySubSize(); },
    onSavePrefs: () => { this.doSavePrefs(); },
    getData: () => this.getPanelData(),
  });
  private readonly watchTracker = new WatchProgressTracker({
    getVideoEl: () => this.videoEl,
    getContext: () => {
      if (!this.media.item) return null;
      return {
        itemId: this.media.item.id,
        season: this.media.season,
        episode: this.media.episode,
        video: this.media.video,
      };
    },
    getDuration: () => this.progressBar.getDuration(),
    getDroppedFrames: () => this.info.getDroppedFrames(),
    log: plog,
  });

  // Flags
  private playbackStarted = false;

  // --- Helpers ---

  private continueWith(overrides: Partial<PlayState>): void {
    this.continuePlaying({
      quality: overrides.quality ?? this.state.quality,
      audio: overrides.audio ?? this.state.audio,
      sub: overrides.sub ?? this.state.sub,
      position: overrides.position ?? this.currentPosition(),
      paused: overrides.paused ?? this.state.paused,
    });
  }

  private getPanelData(): PanelData {
    const subsActive = this.state.sub >= 0 && this.media.subs.length > 0;
    return {
      audioItems: getAudioItems(this.media.audios, this.state.audio, this.videoEl),
      subItems: getSubItems(this.media.subs, this.state.sub),
      qualityItems: getQualityItems(this.media.files, this.state.quality),
      subSizeItems: getSubSizeItems(storage.getSubSize()),
      audioEnabled: this.media.audios.length > 1 && this.media.files.length > 0,
      subsEnabled: this.media.subs.length > 0,
      qualityEnabled: this.media.files.length > 1,
      subSizeEnabled: subsActive,
    };
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
        pos = getResumeTime(this.media.item, this.media.watching, this.media.season, this.media.episode);
        plog.info('getResumeTime ok pos={pos}', { pos });
        this.watchTracker.setWasWatched(isEpisodeWatched(this.media.item, this.media.season, this.media.episode));
        plog.info('isEpisodeWatched ok');
      } else if (this.media.video !== undefined) {
        plog.info('calling findVideoMedia');
        found = findVideoMedia(this.media.item, this.media.video);
        plog.info('findVideoMedia ok found={f}', { f: !!found });
        pos = getResumeTime(this.media.item, this.media.watching, undefined, undefined, this.media.video);
        this.watchTracker.setWasWatched(isVideoWatched(this.media.item, this.media.video));
      }
    } catch (e) {
      const err = e as Error;
      plog.error('loadAndPlay find* threw: {msg} stack={stack}', {
        msg: err && err.message ? err.message : String(e),
        stack: err && err.stack ? err.stack.substring(0, 600) : '',
      });
      this.errorView.showMessage('Ошибка разбора медиа-данных');
      return;
    }

    if (!found) {
      plog.error('loadAndPlay: findEpisode/findVideo returned null');
      this.errorView.showMessage('Видео не найдено');
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
        this.errorView.showMessage('Видео не найдено');
        return;
      }
      plog.info('calling startPlayback q={q} a={a} sub={sub} pos={pos}', { q, a, sub, pos });
      this.startPlayback({ quality: q, audio: a, sub, position: pos, paused: false }, itemTitle + ' - ' + this.media.title);
    });
  }

  private currentPosition(): number {
    if (this.seek.active && this.seek.position >= 0) return this.seek.position;
    return this.videoEl ? this.videoEl.currentTime : 0;
  }

  private startPlayback(next: PlayState, title: string): void {
    plog.info('startPlayback {pos} {quality} {audio} {sub} {paused}', {
      pos: next.position, quality: next.quality, audio: next.audio, sub: next.sub, paused: next.paused,
    });
    this.state = { quality: next.quality, audio: next.audio, sub: next.sub, position: next.position, paused: next.paused };
    if (this.seek.active) this.seek.reset();
    if (this.media.files.length === 0) return;
    const hlsUrl = pickHlsUrl(this.media.files[this.state.quality]);
    if (!hlsUrl) return;
    this.playUrl(hlsUrl, title);
  }

  private continuePlaying(next: PlayState): void {
    const needSource = next.quality !== this.state.quality || next.audio !== this.state.audio || !this.videoEl;
    const needSub = next.sub !== this.state.sub;
    const needSeek = !needSource && Math.abs(next.position - this.currentPosition()) > 2;

    plog.info('continuePlaying {needSource} {needSeek} {needSub}', {
      needSource, needSeek, needSub,
      pos: next.position, quality: next.quality, audio: next.audio, sub: next.sub,
      paused: next.paused, hasVideo: !!this.videoEl,
    });

    this.state = { quality: next.quality, audio: next.audio, sub: next.sub, position: next.position, paused: next.paused };
    if (this.seek.active) this.seek.reset();

    if (needSource) {
      if (this.media.files.length === 0 || !this.videoEl) return;
      const hlsUrl = pickHlsUrl(this.media.files[this.state.quality]);
      if (!hlsUrl) return;
      this.overlay.showSpinner();
      this.playSource(hlsUrl);
      return;
    }

    if (needSeek && this.videoEl) {
      this.videoEl.currentTime = next.position;
    }

    if (needSub && this.videoEl) {
      loadSubtitleTrack(this.videoEl, this.$root, this.media.subs, this.state.sub);
    }
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

  private playSource(originalUrl: string): void {
    if (!this.videoEl) return;
    const audioIndex = this.media.audios.length > 0 ? this.media.audios[this.state.audio].index : 1;
    const target = this.media.files[this.state.quality];
    this.engine.load(this.videoEl, originalUrl, {
      startPosition: this.state.position > 0 ? this.state.position : 0,
      quality: this.state.quality,
      audio: this.state.audio,
      sub: this.state.sub,
      audioIndex,
      qualityTarget: target ? { w: target.w, h: target.h } : null,
    });
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
    this.overlay.hideSpinner();
    this.watchTracker.start();
    this.overlay.showBar();
    this.info.updateBadge();
  }

  private playUrl(url: string, title: string): void {
    const itemTitle = title.split(' - ')[0] || title;
    const epTitle = title.indexOf(' - ') >= 0 ? title.substring(title.indexOf(' - ') + 3) : '';
    this.$root.html(tplPlayer({ title: itemTitle, episode: epTitle }));
    this.videoEl = this.$root.find('video')[0] as HTMLVideoElement;
    this.progressBar.resetElements();
    this.overlay.resetDomCache();
    this.info.resetDomCache();
    this.panel.resetDomCache();

    const bindingsDeps: VideoBindingsDeps = {
      getVideoEl: () => this.videoEl,
      engine: this.engine,
      overlay: this.overlay,
      watchTracker: this.watchTracker,
      trackNavigator: this.trackNavigator,
      errorView: this.errorView,
      sourceUrl: url,
      log: plog,
      onBack: () => router.goBack(),
    };
    bindVideoEvents(this.videoEl, bindingsDeps);

    applySubSize();
    this.playSource(url);
  }

  private destroyPlayer(): void {
    this.watchTracker.sendMarkTime();
    this.watchTracker.stop();
    this.overlay.dispose();
    this.panel.clearIdle();
    this.seek.reset();
    this.overlay.clearSeekLabel();
    this.engine.destroy();
    if (this.videoEl) {
      try { this.videoEl.pause(); } catch { /* ignore */ }
      this.videoEl.removeAttribute('src');
      try { this.videoEl.load(); } catch { /* ignore */ }
      this.videoEl = null;
    }
    this.progressBar.resetElements();
  }

  private resetState(): void {
    this.media = defaultMedia();
    this.state = defaultPlayState();
    this.seek.reset();
    this.panel.reset();
    this.progressBar.resetElements();
    this.playbackStarted = false;
    this.watchTracker.setWasWatched(false);
  }

  // --- Keys ---

  private getKeyCode(e: JQuery.Event): number {
    const orig = (e as { originalEvent?: KeyboardEvent }).originalEvent;
    return (orig && orig.keyCode) ? orig.keyCode : (e.keyCode || 0);
  }

  private readonly handleKey = (e: JQuery.Event): void => {
    const kc = this.getKeyCode(e);
    plog.info('key kc={kc} panelFocused={pf} panelOpen={po} barVisible={bv}', {
      kc, pf: this.panel.focused, po: this.panel.open, bv: this.overlay.barVisible,
    });
    if (!this.videoEl) {
      if (kc === TvKey.Return || kc === TvKey.Backspace || kc === TvKey.Escape || kc === TvKey.Stop) {
        this.destroyPlayer(); router.goBack(); e.preventDefault();
      }
      return;
    }

    if (this.panel.focused) {
      this.panel.handleKey(e, kc);
      return;
    }

    switch (kc) {
      case TvKey.Return: case TvKey.Backspace: case TvKey.Escape: case TvKey.Stop:
        if (kc !== TvKey.Stop && this.overlay.barVisible) {
          this.overlay.hideBar();
        } else {
          this.destroyPlayer(); router.goBack();
        }
        break;

      case TvKey.Enter: case TvKey.PlayPause:
        if (!this.playbackStarted) break;
        if (this.videoEl.paused) {
          plog.info('key Enter/PlayPause paused → play (was paused={paused} videoElPaused={vp})', {
            paused: this.state.paused, vp: this.videoEl.paused,
          });
          this.videoEl.play(); this.state.paused = false; this.overlay.showOsd('play');
        } else {
          plog.info('key Enter/PlayPause play → paused (was paused={paused} videoElPaused={vp})', {
            paused: this.state.paused, vp: this.videoEl.paused,
          });
          this.videoEl.pause(); this.state.paused = true; this.overlay.showOsd('pause');
        }
        this.overlay.showBar(); break;

      case TvKey.Play:
        plog.info('key Play (was paused={paused} videoElPaused={vp})', { paused: this.state.paused, vp: this.videoEl.paused });
        if (this.videoEl.paused) { this.videoEl.play(); this.state.paused = false; this.overlay.showOsd('play'); this.overlay.showBar(); }
        break;
      case TvKey.Pause:
        plog.info('key Pause (was paused={paused} videoElPaused={vp})', { paused: this.state.paused, vp: this.videoEl.paused });
        this.videoEl.pause(); this.state.paused = true; this.overlay.showOsd('pause'); this.overlay.showBar(); break;

      case TvKey.Left: case TvKey.Rw:
        this.seek.start('left'); break;
      case TvKey.Right: case TvKey.Ff:
        this.seek.start('right'); break;

      case TvKey.TrackNext:
        this.trackNavigator.navigate(1); break;
      case TvKey.TrackPrev:
        this.trackNavigator.navigate(-1); break;

      case TvKey.Up:
        this.panel.focus();
        this.overlay.showBar();
        break;
      case TvKey.Down:
        if (this.overlay.barVisible) this.overlay.hideBar();
        break;

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

    loadItemWithWatching(id,
      (item, watching) => {
        try {
          this.media.item = item;
          this.media.watching = watching;
          plog.info('mount loadItemWithWatching ok title={title} hasWatching={hw}', {
            title: item.title, hw: !!watching,
          });
          this.loadAndPlay();
        } catch (e) {
          const err = e as Error;
          plog.error('mount handler threw: {msg} stack={stack}', {
            msg: err && err.message ? err.message : String(e),
            stack: err && err.stack ? err.stack.substring(0, 600) : '',
          });
          this.errorView.showMessage('Ошибка инициализации плеера');
        }
      },
      () => {
        plog.error('mount loadItemWithWatching failed');
        this.errorView.showMessage('Ошибка загрузки');
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
