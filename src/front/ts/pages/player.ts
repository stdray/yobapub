import $ from 'jquery';
import { Page, RouteParams } from '../types/app';
import { getItem } from '../api/items';
import { markTime, toggleWatched } from '../api/watching';
import { Item, VideoFile, AudioTrack, Subtitle } from '../types/api';
import { goBack } from '../router';
import { TvKey, isLegacyTizen } from '../utils/platform';
import { getStreamingType, isProxyAll, proxyUrl } from '../utils/storage';
import { pageKeys, showSpinnerIn, clearPage } from '../utils/page';
import { Logger } from '../utils/log';

const plog = new Logger('player');

import Hls from 'hls.js';
import { tplPlayer } from './player/template';
import { MediaInfo, findEpisodeMedia, findVideoMedia, loadMediaLinks, getResumeTime, isEpisodeWatched, isVideoWatched } from './player/media';
import { getRewrittenHlsUrl } from './player/hls';
import { applySubSize, changeSubSize, loadSubtitleTrack } from './player/subtitles';
import { ProgressState, getVideoDuration, updateProgress } from './player/progress';
import { PanelState, PanelCallbacks, PanelData, getAudioItems, getSubItems, getQualityItems, openPanel as panelOpen_, closePanel as panelClose_, handlePanelKey, clearPanelIdle } from './player/panel';
import { restoreQualityIndex, restoreAudioIndex, restoreSubIndex, saveCurrentPrefs, getTitlePrefs } from './player/preferences';
import { InfoState, updateInfoBadge, showInfo, hideInfo } from './player/info';

const $root = $('#page-player');
const keys = pageKeys();

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

// --- Module state ---

let videoEl: HTMLVideoElement | null = null;
let hlsInstance: Hls | null = null;
let playSourceDebug = '';
let playbackStarted = false;
let markTimer: number | null = null;

const media: MediaContext = {
  item: null,
  season: undefined,
  episode: undefined,
  video: undefined,
  files: [],
  audios: [],
  subs: [],
  title: '',
  duration: 0,
  hlsUrl: '',
};

let state: PlayState = { quality: 0, audio: 0, sub: -1, position: 0, paused: false };

const seekState: SeekState = {
  pos: -1,
  count: 0,
  dir: '',
  active: false,
  applyTimer: null,
};

// --- Progress state ---

const progressState: ProgressState = {
  videoEl: null,
  currentDuration: 0,
  seeking: false,
  seekPos: -1,
  barValueEl: null,
  barPctEl: null,
  barDurationEl: null,
  barSeekEl: null
};

const syncProgressState = (): void => {
  progressState.videoEl = videoEl;
  progressState.currentDuration = media.duration;
  progressState.seeking = seekState.active;
  progressState.seekPos = seekState.pos;
};

// --- Panel state ---

const panelState: PanelState = {
  open: false,
  btnIndex: 0,
  listOpen: false,
  listIndex: 0,
  listSection: 0
};

const getInfoState = (): InfoState => ({
  files: media.files,
  audios: media.audios,
  subs: media.subs,
  selectedQuality: state.quality,
  selectedAudio: state.audio,
  selectedSub: state.sub
});

const hasHlsUrl = (): boolean => media.files.length > 0;

const getPanelData = (): PanelData => ({
  audioItems: getAudioItems(media.audios, state.audio, videoEl),
  subItems: getSubItems(media.subs, state.sub),
  qualityItems: getQualityItems(media.files, state.quality),
  audioEnabled: media.audios.length > 1 && hasHlsUrl(),
  subsEnabled: media.subs.length > 0,
  qualityEnabled: media.files.length > 1
});

const panelCallbacks: PanelCallbacks = {
  onShowBar: () => { showBar(); },
  onHideBar: () => { hideBar(); },
  onClearBarTimer: () => { clearBarTimer(); },
  onApplyAudio: (idx) => {
    continuePlaying({ quality: state.quality, audio: idx, sub: state.sub, position: currentPosition(), paused: state.paused });
  },
  onApplySub: (menuIdx) => {
    continuePlaying({ quality: state.quality, audio: state.audio, sub: menuIdx - 1, position: currentPosition(), paused: state.paused });
  },
  onApplyQuality: (idx) => {
    if (idx !== state.quality) {
      continuePlaying({ quality: idx, audio: state.audio, sub: state.sub, position: currentPosition(), paused: state.paused });
    }
  },
  onSavePrefs: () => { doSavePrefs(); },
  getData: getPanelData
};

// --- Toast / OSD ---

let toastTimer: number | null = null;
let osdTimer: number | null = null;

const showToast = (text: string): void => {
  let $toast = $root.find('.player__toast');
  if ($toast.length === 0) {
    $root.find('.player').append('<div class="player__toast"></div>');
    $toast = $root.find('.player__toast');
  }
  $toast.text(text).removeClass('hidden');
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { $toast.addClass('hidden'); toastTimer = null; }, 1500);
};

const showOsd = (icon: string): void => {
  const symbols: Record<string, string> = { play: '\u25B6', pause: '\u275A\u275A', rw: '\u23EA', ff: '\u23E9' };
  $root.find('.player__osd').text(symbols[icon] || icon).removeClass('hidden');
  if (osdTimer) clearTimeout(osdTimer);
  osdTimer = window.setTimeout(() => {
    $root.find('.player__osd').addClass('hidden');
    osdTimer = null;
  }, 700);
};

// --- Seek ---

const startSeek = (dir: string): void => {
  seekState.active = true;
  if (seekState.dir !== dir) { seekState.dir = dir; seekState.count = 0; }
  if (seekState.pos === -1 && videoEl) seekState.pos = videoEl.currentTime;

  syncProgressState();
  const step = 10 + Math.pow(Math.min(seekState.count, 3000), 3) / 1000;
  const dur = getVideoDuration(progressState);
  seekState.pos += dir === 'right' ? step : -step;
  seekState.pos = Math.max(0, dur > 0 ? Math.min(seekState.pos, dur - 2) : seekState.pos);
  seekState.count++;

  if (seekState.count === 1) {
    plog.debug('startSeek {dir} seekPos={seekPos} step={step}', { dir, seekPos: seekState.pos, step });
  }

  syncProgressState();
  updateProgress($root, progressState);
  showOsd(dir === 'right' ? 'ff' : 'rw');
  showBar();

  if (seekState.applyTimer) clearTimeout(seekState.applyTimer);
  seekState.applyTimer = window.setTimeout(applySeek, 2000);
};

const applySeek = (): void => {
  if (!seekState.active || seekState.pos < 0 || !videoEl) return;
  syncProgressState();
  const dur = getVideoDuration(progressState);
  if (dur > 0) seekState.pos = Math.min(seekState.pos, dur - 2);
  seekState.pos = Math.max(0, seekState.pos);
  const pos = seekState.pos;
  plog.info('applySeek pos={pos} dur={dur}', { pos, dur });
  resetSeek();
  continuePlaying({ quality: state.quality, audio: state.audio, sub: state.sub, position: pos, paused: state.paused });
  showBar();
};

const resetSeek = (): void => {
  seekState.pos = -1; seekState.count = 0; seekState.dir = ''; seekState.active = false;
  if (seekState.applyTimer) { clearTimeout(seekState.applyTimer); seekState.applyTimer = null; }
  $root.find('.player__bar-seek').text('');
};

// --- Track navigation ---

const navigateTrack = (dir: number): boolean => {
  if (!media.item) return false;

  if (media.season !== undefined && media.episode !== undefined && media.item.seasons) {
    for (let si = 0; si < media.item.seasons.length; si++) {
      const s = media.item.seasons[si];
      if (s.number !== media.season) continue;
      for (let ei = 0; ei < s.episodes.length; ei++) {
        if (s.episodes[ei].number !== media.episode) continue;
        const targetIdx = ei + dir;
        if (targetIdx >= 0 && targetIdx < s.episodes.length) {
          savePosition(); destroyPlayer();
          media.episode = s.episodes[targetIdx].number;
          remountTrack();
          return true;
        }
        const targetSeason = si + dir;
        if (targetSeason >= 0 && targetSeason < media.item.seasons.length) {
          const ts = media.item.seasons[targetSeason];
          const ep = dir > 0 ? ts.episodes[0] : ts.episodes[ts.episodes.length - 1];
          if (ep) {
            savePosition(); destroyPlayer();
            media.season = ts.number;
            media.episode = ep.number;
            remountTrack();
            return true;
          }
        }
        return false;
      }
    }
  } else if (media.video !== undefined && media.item.videos) {
    const newVideo = media.video + dir;
    if (newVideo >= 1 && newVideo <= media.item.videos.length) {
      savePosition(); destroyPlayer();
      media.video = newVideo;
      remountTrack();
      return true;
    }
  }
  return false;
};

const remountTrack = (): void => {
  if (!media.item) return;
  let found: MediaInfo | null = null;
  let pos = 0;

  if (media.season !== undefined && media.episode !== undefined) {
    found = findEpisodeMedia(media.item, media.season, media.episode);
    pos = getResumeTime(media.item, media.season, media.episode);
    wasWatched = isEpisodeWatched(media.item, media.season, media.episode);
  } else if (media.video !== undefined) {
    found = findVideoMedia(media.item, media.video);
    pos = getResumeTime(media.item, undefined, undefined, media.video);
    wasWatched = isVideoWatched(media.item, media.video);
  }

  if (!found) return;

  const itemTitle = media.item.title.split(' / ')[0];
  media.title = found.title;
  media.duration = found.duration;
  media.audios = found.audios;
  const prefs = media.item ? getTitlePrefs(media.item.id) : null;

  loadMediaLinks(found.mid, (files, subs) => {
    media.files = files.slice().sort((a, b) => b.w - a.w);
    media.subs = subs.filter((s) => s.url && !s.embed);
    const q = restoreQualityIndex(media.files, prefs);
    const a = restoreAudioIndex(media.audios, prefs);
    const sub = restoreSubIndex(media.subs, prefs);

    if (media.files.length === 0) return;
    continuePlaying({ quality: q, audio: a, sub, position: pos, paused: false }, itemTitle + ' - ' + media.title);
  });
};

const getHlsUrl = (f: VideoFile): string => {
  const hls4 = (f.urls && f.urls.hls4) || (f.url && f.url.hls4) || '';
  const hls2 = (f.urls && f.urls.hls2) || (f.url && f.url.hls2) || '';
  if (isLegacyTizen()) return hls2;
  const sp = getStreamingType();
  if (sp === 'hls4') return hls4;
  if (sp === 'hls2') return hls2;
  return hls4 || hls2;
};

const currentPosition = (): number => {
  if (seekState.active && seekState.pos >= 0) return seekState.pos;
  return videoEl ? videoEl.currentTime : 0;
};

const continuePlaying = (next: PlayState, title?: string): void => {
  const needSource = next.quality !== state.quality || next.audio !== state.audio || !videoEl;
  const needSub = next.sub !== state.sub;
  const needSeek = !needSource && Math.abs(next.position - currentPosition()) > 2;

  plog.info('continuePlaying {needSource} {needSeek} {needSub}', {
    needSource, needSeek, needSub,
    pos: next.position, quality: next.quality, audio: next.audio, sub: next.sub,
    paused: next.paused, hasVideo: !!videoEl,
  });

  state = { quality: next.quality, audio: next.audio, sub: next.sub, position: next.position, paused: next.paused };
  if (seekState.active) resetSeek();

  if (needSource) {
    if (media.files.length === 0) return;
    const f = media.files[state.quality];
    let hlsUrl = getHlsUrl(f);
    if (!hlsUrl) return;
    if (isProxyAll()) hlsUrl = proxyUrl(hlsUrl);
    media.hlsUrl = hlsUrl;
    const audioIndex = media.audios.length > 0 ? media.audios[state.audio].index : 1;
    const rewriteUrl = getRewrittenHlsUrl(hlsUrl, audioIndex);
    if (!videoEl) {
      playUrl(rewriteUrl, title || media.title);
    } else {
      showSpinner();
      playSource(rewriteUrl);
    }
    return;
  }

  if (needSeek && videoEl) {
    videoEl.currentTime = next.position;
  }

  if (needSub && videoEl) {
    loadSubtitleTrack(videoEl, $root, media.subs, state.sub);
  }
};

// --- Bar show/hide ---

let barTimer: number | null = null;
let progressTimer: number | null = null;

const startProgressTimer = (): void => {
  stopProgressTimer();
  progressTimer = window.setInterval(() => {
    syncProgressState();
    updateProgress($root, progressState);
  }, 1000);
};

const stopProgressTimer = (): void => {
  if (progressTimer !== null) { clearInterval(progressTimer); progressTimer = null; }
};

const showBar = (): void => {
  $root.find('.player__header, .player__gradient, .player__bar').removeClass('hidden');
  showInfo($root, getInfoState());
  syncProgressState();
  updateProgress($root, progressState);
  startProgressTimer();
  clearBarTimer();
  if (!panelState.open && !seekState.active) {
    barTimer = window.setTimeout(hideBar, 4000);
  }
};

const hideBar = (): void => {
  stopProgressTimer();
  $root.find('.player__header, .player__gradient, .player__bar').addClass('hidden');
  hideInfo($root);
};

const clearBarTimer = (): void => {
  if (barTimer !== null) { clearTimeout(barTimer); barTimer = null; }
};

// --- Audio / Sub / Quality switching ---

const doSavePrefs = (): void => {
  if (!media.item) return;
  saveCurrentPrefs(media.item.id, media.files, media.audios, media.subs, state.quality, state.audio, state.sub);
};



// --- Playback ---

const buildHlsConfig = (): Record<string, number> => {
  const cfg: Record<string, number> = {};
  if (state.position > 0) cfg.startPosition = state.position;
  cfg.maxBufferLength = 10;
  cfg.maxMaxBufferLength = 30;
  cfg.maxBufferHole = 1.0;
  cfg.highBufferWatchdogPeriod = 10;
  cfg.nudgeMaxRetry = 3;
  cfg.abrEwmaFastLive = 5.0;
  cfg.abrEwmaSlowLive = 10.0;
  cfg.abrEwmaFastVoD = 5.0;
  cfg.abrEwmaSlowVoD = 10.0;
  cfg.fragLoadingMaxRetry = 6;
  cfg.manifestLoadingMaxRetry = 3;
  cfg.levelLoadingMaxRetry = 4;
  return cfg;
};

const playSource = (url: string): void => {
  if (!videoEl) return;
  media.hlsUrl = url;
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
  playSourceDebug = 'url=' + url.substring(0, 120);
  const cfg = buildHlsConfig();
  plog.info('playSource startPosition={startPosition} ua={ua} yobapub_ver={yobapub_ver} url={url}', {
    startPosition: cfg.startPosition || 0,
    ua: navigator.userAgent,
    yobapub_ver: __APP_VERSION__,
    url: url.substring(0, 120),
  });
  const hls = new Hls(cfg);
  hlsInstance = hls;
  hls.on(Hls.Events.FRAG_LOADING, (_e: string, data: { frag?: { sn: number; start: number; duration: number } }) => {
    const frag = data.frag;
    if (frag) {
      plog.info('hls FRAG_LOADING sn={sn} start={start} dur={dur}', {
        sn: frag.sn, start: frag.start, dur: frag.duration,
      });
    }
  });
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    plog.info('hls MANIFEST_PARSED');
    onSourceReady();
  });
  hls.on(Hls.Events.ERROR, (_e: string, data: { fatal: boolean; type: string; details: string; reason?: string; response?: { code: number }; frag?: { url?: string; sn?: number; start?: number } }) => {
    if (!data.fatal) {
      plog.debug('hls error (non-fatal) {type} {details} {reason} {fragUrl}', {
        type: data.type, details: data.details,
        reason: data.reason || null,
        fragUrl: data.frag ? (data.frag.url || '').substring(0, 120) : null,
        fragSn: data.frag ? data.frag.sn : null,
        fragStart: data.frag ? data.frag.start : null,
      });
      return;
    }
    plog.error('hls fatal {type} {details} {status}', {
      type: data.type, details: data.details,
      status: data.response ? data.response.code : null,
    });
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
      plog.warn('hls recoverMediaError');
      hls.recoverMediaError();
      return;
    }
    showPlaybackError(null, url, 'hls fatal: type=' + data.type + ' details=' + data.details + (data.response ? ' status=' + data.response.code : ''));
  });
  hls.loadSource(url);
  hls.attachMedia(videoEl);
};

const onSourceReady = (): void => {
  if (!videoEl) return;
  plog.info('onSourceReady pos={pos} paused={paused} ct={ct}', { pos: state.position, paused: state.paused, ct: videoEl.currentTime });
  if (state.position > 0) {
    const pos = state.position;
    const v = videoEl;
    let done = false;
    const onTimeUpdate = () => {
      if (done || v !== videoEl) return;
      if (v.currentTime < 1 && v.buffered.length === 0) return;
      done = true;
      v.removeEventListener('timeupdate', onTimeUpdate);
      plog.info('onSourceReady stable ct={ct}, seeking to {pos}', { ct: v.currentTime, pos });
      if (Math.abs(v.currentTime - pos) > 2) {
        v.currentTime = pos;
      }
    };
    v.addEventListener('timeupdate', onTimeUpdate);
    v.play();
  } else {
    if (!state.paused) videoEl.play();
  }
  playbackStarted = true;
  if (state.sub >= 0 && videoEl) {
    loadSubtitleTrack(videoEl, $root, media.subs, state.sub);
  }
  hideSpinner();
  startMarkTimer();
  showBar();
  updateInfoBadge($root, getInfoState());
};

const showSpinner = (): void => {
  $root.find('.player__spinner').show();
};

const hideSpinner = (): void => {
  $root.find('.player__spinner').hide();
};

const getVideoErrorMessage = (error: MediaError | null): string => {
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
};

const showPlaybackError = (error: MediaError | null, url: string, debugMsg?: string): void => {
  const msg = getVideoErrorMessage(error);
  const code = error ? error.code : 0;
  const detail = error && (error as { message?: string }).message ? (error as { message?: string }).message : '';
  plog.error('playbackError {code} {msg} {detail} {debugMsg}', {
    code, msg, detail: detail || null, debugMsg: debugMsg || null,
    url: url.substring(0, 120), ua: navigator.userAgent,
  });
  console.error('[Player] Playback error: code=' + code + ' msg=' + msg + (detail ? ' detail=' + detail : '') + ' url=' + url);
  console.error('[Player] UA=' + navigator.userAgent);
  destroyPlayer();
  $root.html(
    '<div class="player">' +
      '<div class="player__title" style="padding:60px;">' +
        '<div>' + msg + '</div>' +
        '<div class="player__error-debug">Код ошибки: ' + code + '</div>' +
        '<div class="player__error-debug">' + (debugMsg || playSourceDebug) + '</div>' +
        '<div class="player__error-debug">' + navigator.userAgent + '</div>' +
      '</div>' +
    '</div>'
  );
  keys.unbind();
  keys.bind((e: JQuery.Event) => {
    const kc = getKeyCode(e);
    if (kc === TvKey.Return || kc === TvKey.Backspace || kc === TvKey.Escape) {
      goBack();
      e.preventDefault();
    }
  });
};

const playUrl = (url: string, title: string): void => {
  const itemTitle = title.split(' - ')[0] || title;
  const epTitle = title.indexOf(' - ') >= 0 ? title.substring(title.indexOf(' - ') + 3) : '';
  $root.html(tplPlayer({ title: itemTitle, episode: epTitle }));
  videoEl = $root.find('video')[0] as HTMLVideoElement;
  progressState.barValueEl = null;
  progressState.barPctEl = null;
  progressState.barDurationEl = null;
  progressState.barSeekEl = null;

  const sourceUrl = url;
  videoEl.addEventListener('ended', () => {
    plog.info('video ended currentTime={currentTime}', { currentTime: videoEl ? videoEl.currentTime : -1 });
    if (!markedWatched) markWatched();
    if (!navigateTrack(1)) goBack();
  });
  videoEl.addEventListener('waiting', () => {
    plog.debug('video waiting currentTime={currentTime}', { currentTime: videoEl ? videoEl.currentTime : -1 });
    showSpinner();
  });
  videoEl.addEventListener('seeking', () => {
    plog.debug('video seeking currentTime={currentTime}', { currentTime: videoEl ? videoEl.currentTime : -1 });
  });
  videoEl.addEventListener('canplay', () => {
    plog.debug('video canplay currentTime={currentTime}', { currentTime: videoEl ? videoEl.currentTime : -1 });
    hideSpinner();
  });
  videoEl.addEventListener('playing', () => {
    const v = videoEl;
    const bl = v ? v.buffered.length : 0;
    let br = '[none]';
    if (v && bl > 0) {
      const parts: string[] = [];
      for (let i = 0; i < bl; i++) parts.push(v.buffered.start(i).toFixed(1) + '-' + v.buffered.end(i).toFixed(1));
      br = parts.join(',');
    }
    plog.info('video playing ct={ct} readyState={rs} buffered={br}', {
      ct: v ? v.currentTime : -1, rs: v ? v.readyState : -1, br,
    });
    hideSpinner();
  });
  videoEl.addEventListener('seeked', () => {
    const v = videoEl;
    const bl = v ? v.buffered.length : 0;
    let br = '[none]';
    if (v && bl > 0) {
      const parts: string[] = [];
      for (let i = 0; i < bl; i++) parts.push(v.buffered.start(i).toFixed(1) + '-' + v.buffered.end(i).toFixed(1));
      br = parts.join(',');
    }
    plog.debug('video seeked ct={ct} readyState={rs} buffered={br}', {
      ct: v ? v.currentTime : -1, rs: v ? v.readyState : -1, br,
    });
    hideSpinner();
  });
  videoEl.addEventListener('error', () => {
    const err2 = videoEl ? videoEl.error : null;
    plog.error('video error code={code} message={message}', {
      code: err2 ? err2.code : null,
      message: err2 ? (err2 as { message?: string }).message || null : null,
    });
    if (videoEl) showPlaybackError(videoEl.error, sourceUrl);
  });

  applySubSize();
  playSource(url);
};

// --- Mark time ---

let markedWatched = false;
let wasWatched = false;

const startMarkTimer = (): void => {
  stopMarkTimer();
  markedWatched = false;
  markTimer = window.setInterval(() => {
    if (!videoEl || !media.item) return;
    const time = Math.floor(videoEl.currentTime);
    if (time <= 0) return;
    if (media.season !== undefined && media.episode !== undefined) {
      markTime(media.item.id, media.episode, time, media.season);
    } else if (media.video !== undefined) {
      markTime(media.item.id, media.video, time);
    }
    // After ~30s of playback, reset watched status so the item
    // reappears as "in progress" instead of "watched".
    if (wasWatched) {
      wasWatched = false;
      plog.info('resetting watched status after 30s of playback');
      if (media.season !== undefined && media.episode !== undefined) {
        toggleWatched(media.item.id, media.episode, media.season);
      } else if (media.video !== undefined) {
        toggleWatched(media.item.id, media.video);
      }
    }
    if (!markedWatched) {
      syncProgressState();
      const dur = getVideoDuration(progressState);
      if (dur > 0) {
        const isSerial = media.season !== undefined;
        const threshold = isSerial ? 120 : 420;
        if (dur - time <= threshold) {
          markedWatched = true;
          markWatched();
        }
      }
    }
  }, 30000);
};

const stopMarkTimer = (): void => {
  if (markTimer !== null) { clearInterval(markTimer); markTimer = null; }
};

const savePosition = (): void => {
  if (!videoEl || !media.item) return;
  const time = Math.floor(videoEl.currentTime);
  if (time <= 0) return;
  if (media.season !== undefined && media.episode !== undefined) {
    markTime(media.item.id, media.episode, time, media.season);
  } else if (media.video !== undefined) {
    markTime(media.item.id, media.video, time);
  }
};

const markWatched = (): void => {
  if (!media.item) return;
  if (media.season !== undefined && media.episode !== undefined) {
    toggleWatched(media.item.id, media.episode, media.season);
  } else if (media.video !== undefined) {
    toggleWatched(media.item.id, media.video);
  }
};

const destroyPlayer = (): void => {
  savePosition();
  stopMarkTimer();
  stopProgressTimer();
  clearBarTimer();
  clearPanelIdle();
  resetSeek();
  if (osdTimer) { clearTimeout(osdTimer); osdTimer = null; }
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
  if (videoEl) {
    try { videoEl.pause(); } catch (e) { /* ignore */ }
    videoEl.removeAttribute('src');
    try { videoEl.load(); } catch (e) { /* ignore */ }
    videoEl = null;
  }
  progressState.barValueEl = null;
  progressState.barPctEl = null;
  progressState.barDurationEl = null;
  progressState.barSeekEl = null;
  media.hlsUrl = '';
};

// --- Keys ---

const getKeyCode = (e: JQuery.Event): number => {
  const orig = (e as { originalEvent?: KeyboardEvent }).originalEvent;
  return (orig && orig.keyCode) ? orig.keyCode : (e.keyCode || 0);
};

const handleKey = (e: JQuery.Event): void => {
  const kc = getKeyCode(e);
  if (!videoEl) {
    if (kc === TvKey.Return || kc === TvKey.Backspace || kc === TvKey.Escape || kc === TvKey.Stop) {
      destroyPlayer(); goBack(); e.preventDefault();
    }
    return;
  }

  if (panelState.open) {
    handlePanelKey(e, kc, $root, panelState, panelCallbacks);
    return;
  }

  switch (kc) {
    case TvKey.Return: case TvKey.Backspace: case TvKey.Escape: case TvKey.Stop:
      destroyPlayer(); goBack(); break;

    case TvKey.Enter: case TvKey.PlayPause:
      if (!playbackStarted) break;
      if (videoEl.paused) {
        plog.info('key Enter/PlayPause paused → play (was paused={paused} videoElPaused={vp})', {
          paused: state.paused, vp: videoEl.paused,
        });
        videoEl.play(); state.paused = false; showOsd('play');
      } else {
        plog.info('key Enter/PlayPause play → paused (was paused={paused} videoElPaused={vp})', {
          paused: state.paused, vp: videoEl.paused,
        });
        videoEl.pause(); state.paused = true; showOsd('pause');
      }
      showBar(); break;

    case TvKey.Play:
      plog.info('key Play (was paused={paused} videoElPaused={vp})', { paused: state.paused, vp: videoEl.paused });
      if (videoEl.paused) { videoEl.play(); state.paused = false; showOsd('play'); showBar(); }
      break;
    case TvKey.Pause:
      plog.info('key Pause (was paused={paused} videoElPaused={vp})', { paused: state.paused, vp: videoEl.paused });
      videoEl.pause(); state.paused = true; showOsd('pause'); showBar(); break;

    case TvKey.Left: case TvKey.Rw:
      startSeek('left'); break;
    case TvKey.Right: case TvKey.Ff:
      startSeek('right'); break;

    case TvKey.TrackNext:
      navigateTrack(1); break;
    case TvKey.TrackPrev:
      navigateTrack(-1); break;

    case TvKey.Up:
      panelOpen_($root, panelState, panelCallbacks); break;
    case TvKey.Down:
      showBar(); break;

    case TvKey.Green:
      changeSubSize(1, showToast); break;
    case TvKey.Red:
      changeSubSize(-1, showToast); break;
  }
  e.preventDefault();
};

// --- Page ---

export const playerPage: Page = {
  mount: (params: RouteParams) => {
    media.item = null;
    media.season = params.season;
    media.episode = params.episode;
    media.video = params.video;
    playbackStarted = false;
    panelState.open = false;
    panelState.listOpen = false;
    media.files = [];
    media.audios = [];
    media.subs = [];
    state = { quality: 0, audio: 0, sub: -1, position: 0, paused: false };

    showSpinnerIn($root);
    const id = params.id!;

    getItem(id).then(
      (itemRes: { item: Item }) => {
        const data = Array.isArray(itemRes) ? itemRes[0] : itemRes;
        media.item = data.item;
        if (!media.item) return;

        let found: MediaInfo | null = null;
        let pos = 0;

        if (media.season !== undefined && media.episode !== undefined) {
          found = findEpisodeMedia(media.item, media.season, media.episode);
          pos = getResumeTime(media.item, media.season, media.episode);
          wasWatched = isEpisodeWatched(media.item, media.season, media.episode);
        } else if (media.video !== undefined) {
          found = findVideoMedia(media.item, media.video);
          pos = getResumeTime(media.item, undefined, undefined, media.video);
          wasWatched = isVideoWatched(media.item, media.video);
        }

        if (!found) {
          $root.html('<div class="player"><div class="player__title" style="padding:60px;">Видео не найдено</div></div>');
          return;
        }

        media.title = found.title;
        media.duration = found.duration;
        media.audios = found.audios;
        const itemTitle = media.item.title.split(' / ')[0];
        const prefs = getTitlePrefs(media.item.id);

        loadMediaLinks(found.mid, (files, subs) => {
          media.files = files.slice().sort((a, b) => b.w - a.w);
          media.subs = subs.filter((s) => s.url && !s.embed);
          const q = restoreQualityIndex(media.files, prefs);
          const a = restoreAudioIndex(media.audios, prefs);
          const sub = restoreSubIndex(media.subs, prefs);

          if (media.files.length === 0) {
            $root.html('<div class="player"><div class="player__title" style="padding:60px;">Видео не найдено</div></div>');
            return;
          }
          continuePlaying({ quality: q, audio: a, sub, position: pos, paused: false }, itemTitle + ' - ' + media.title);
        });
      },
      () => {
        $root.html('<div class="player"><div class="player__title" style="padding:60px;">Ошибка загрузки</div></div>');
      }
    );

    keys.bind(handleKey);
  },

  unmount: () => {
    destroyPlayer();
    keys.unbind();
    clearPage($root);
    panelState.open = false;
    panelState.listOpen = false;
  }
};
