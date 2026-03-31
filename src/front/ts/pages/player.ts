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
let markTimer: number | null = null;
let videoEl: HTMLVideoElement | null = null;
let videoStalled = false;


let currentItem: Item | null = null;
let currentSeason: number | undefined;
let currentEpisode: number | undefined;
let currentVideo: number | undefined;

let currentFiles: VideoFile[] = [];
let currentAudios: AudioTrack[] = [];
let currentSubs: Subtitle[] = [];
let currentTitle = '';
let currentDuration = 0;
let currentHlsUrl = '';
let hlsInstance: Hls | null = null;
let playSourceDebug = '';
let playbackStarted = false;
let pendingSeekPos = -1;

interface PlayState {
  quality: number;
  audio: number;
  sub: number;
  position: number;
  paused: boolean;
}

let state: PlayState = { quality: 0, audio: 0, sub: -1, position: 0, paused: false };

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

function syncProgressState(): void {
  progressState.videoEl = videoEl;
  progressState.currentDuration = currentDuration;
  progressState.seeking = seeking;
  progressState.seekPos = seekPos;
}

// --- Panel state ---

const panelState: PanelState = {
  open: false,
  btnIndex: 0,
  listOpen: false,
  listIndex: 0,
  listSection: 0
};

function getInfoState(): InfoState {
  return {
    files: currentFiles,
    audios: currentAudios,
    subs: currentSubs,
    selectedQuality: state.quality,
    selectedAudio: state.audio,
    selectedSub: state.sub
  };
}

function hasHlsUrl(): boolean {
  return currentFiles.length > 0;
}

function getPanelData(): PanelData {
  return {
    audioItems: getAudioItems(currentAudios, state.audio, videoEl),
    subItems: getSubItems(currentSubs, state.sub),
    qualityItems: getQualityItems(currentFiles, state.quality),
    audioEnabled: currentAudios.length > 1 && hasHlsUrl(),
    subsEnabled: currentSubs.length > 0,
    qualityEnabled: currentFiles.length > 1
  };
}

const panelCallbacks: PanelCallbacks = {
  onShowBar: function () { showBar(); },
  onHideBar: function () { hideBar(); },
  onClearBarTimer: function () { clearBarTimer(); },
  onApplyAudio: function (idx) {
    continuePlaying({ quality: state.quality, audio: idx, sub: state.sub, position: currentPosition(), paused: state.paused });
  },
  onApplySub: function (menuIdx) {
    continuePlaying({ quality: state.quality, audio: state.audio, sub: menuIdx - 1, position: currentPosition(), paused: state.paused });
  },
  onApplyQuality: function (idx) {
    if (idx !== state.quality) {
      continuePlaying({ quality: idx, audio: state.audio, sub: state.sub, position: currentPosition(), paused: state.paused });
    }
  },
  onSavePrefs: function () { doSavePrefs(); },
  getData: getPanelData
};

// --- Toast / OSD ---

let toastTimer: number | null = null;
let osdTimer: number | null = null;

function showToast(text: string): void {
  let $toast = $root.find('.player__toast');
  if ($toast.length === 0) {
    $root.find('.player').append('<div class="player__toast"></div>');
    $toast = $root.find('.player__toast');
  }
  $toast.text(text).removeClass('hidden');
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(function () { $toast.addClass('hidden'); toastTimer = null; }, 1500);
}

function showOsd(icon: string): void {
  const symbols: Record<string, string> = { play: '\u25B6', pause: '\u275A\u275A', rw: '\u23EA', ff: '\u23E9' };
  $root.find('.player__osd').text(symbols[icon] || icon).removeClass('hidden');
  if (osdTimer) clearTimeout(osdTimer);
  osdTimer = window.setTimeout(function () {
    $root.find('.player__osd').addClass('hidden');
    osdTimer = null;
  }, 700);
}

// --- Seek ---

let seekPos = -1;
let seekCount = 0;
let seekDir = '';
let seeking = false;
let seekApplyTimer: number | null = null;

function startSeek(dir: string): void {
  seeking = true;
  if (seekDir !== dir) { seekDir = dir; seekCount = 0; }
  if (seekPos === -1 && videoEl) seekPos = videoEl.currentTime;

  syncProgressState();
  const step = 10 + Math.pow(Math.min(seekCount, 3000), 3) / 1000;
  const dur = getVideoDuration(progressState);
  seekPos += dir === 'right' ? step : -step;
  seekPos = Math.max(0, dur > 0 ? Math.min(seekPos, dur - 2) : seekPos);
  seekCount++;

  plog.debug('startSeek {dir} seekPos={seekPos} step={step} count={count}', {
    dir, seekPos, step, count: seekCount,
  });

  syncProgressState();
  updateProgress($root, progressState);
  showOsd(dir === 'right' ? 'ff' : 'rw');
  showBar();

  if (seekApplyTimer) clearTimeout(seekApplyTimer);
  seekApplyTimer = window.setTimeout(applySeek, 2000);
}

function applySeek(): void {
  if (!seeking || seekPos < 0 || !videoEl) return;
  syncProgressState();
  const dur = getVideoDuration(progressState);
  if (dur > 0) seekPos = Math.min(seekPos, dur - 2);
  seekPos = Math.max(0, seekPos);
  let pos = seekPos;
  plog.info('applySeek pos={pos} dur={dur}', { pos, dur });
  resetSeek();
  continuePlaying({ quality: state.quality, audio: state.audio, sub: state.sub, position: pos, paused: state.paused });
  showBar();
}

function resetSeek(): void {
  seekPos = -1; seekCount = 0; seekDir = ''; seeking = false;
  if (seekApplyTimer) { clearTimeout(seekApplyTimer); seekApplyTimer = null; }
  $root.find('.player__bar-seek').text('');
}

// --- Track navigation ---

function navigateTrack(dir: number): boolean {
  if (!currentItem) return false;

  if (currentSeason !== undefined && currentEpisode !== undefined && currentItem.seasons) {
    for (var si = 0; si < currentItem.seasons.length; si++) {
      const s = currentItem.seasons[si];
      if (s.number !== currentSeason) continue;
      for (var ei = 0; ei < s.episodes.length; ei++) {
        if (s.episodes[ei].number !== currentEpisode) continue;
        const targetIdx = ei + dir;
        if (targetIdx >= 0 && targetIdx < s.episodes.length) {
          savePosition(); destroyPlayer();
          currentEpisode = s.episodes[targetIdx].number;
          remountTrack();
          return true;
        }
        const targetSeason = si + dir;
        if (targetSeason >= 0 && targetSeason < currentItem.seasons.length) {
          const ts = currentItem.seasons[targetSeason];
          const ep = dir > 0 ? ts.episodes[0] : ts.episodes[ts.episodes.length - 1];
          if (ep) {
            savePosition(); destroyPlayer();
            currentSeason = ts.number;
            currentEpisode = ep.number;
            remountTrack();
            return true;
          }
        }
        return false;
      }
    }
  } else if (currentVideo !== undefined && currentItem.videos) {
    const newVideo = currentVideo + dir;
    if (newVideo >= 1 && newVideo <= currentItem.videos.length) {
      savePosition(); destroyPlayer();
      currentVideo = newVideo;
      remountTrack();
      return true;
    }
  }
  return false;
}

function remountTrack(): void {
  if (!currentItem) return;
  let media: MediaInfo | null = null;
  let pos = 0;

  if (currentSeason !== undefined && currentEpisode !== undefined) {
    media = findEpisodeMedia(currentItem, currentSeason, currentEpisode);
    pos = getResumeTime(currentItem, currentSeason, currentEpisode);
    wasWatched = isEpisodeWatched(currentItem, currentSeason, currentEpisode);
  } else if (currentVideo !== undefined) {
    media = findVideoMedia(currentItem, currentVideo);
    pos = getResumeTime(currentItem, undefined, undefined, currentVideo);
    wasWatched = isVideoWatched(currentItem, currentVideo);
  }

  if (!media) return;

  const itemTitle = currentItem.title.split(' / ')[0];
  currentTitle = media.title;
  currentDuration = media.duration;
  currentAudios = media.audios;
  const prefs = currentItem ? getTitlePrefs(currentItem.id) : null;

  loadMediaLinks(media.mid, function (files, subs) {
    currentFiles = files.slice().sort(function (a, b) { return b.w - a.w; });
    currentSubs = subs.filter(function (s) { return s.url && !s.embed; });
    const q = restoreQualityIndex(currentFiles, prefs);
    const a = restoreAudioIndex(currentAudios, prefs);
    const s = restoreSubIndex(currentSubs, prefs);

    if (currentFiles.length === 0) return;
    continuePlaying({ quality: q, audio: a, sub: s, position: pos, paused: false }, itemTitle + ' - ' + currentTitle);
  });
}

function getHlsUrl(f: VideoFile): string {
  const hls4 = (f.urls && f.urls.hls4) || (f.url && f.url.hls4) || '';
  const hls2 = (f.urls && f.urls.hls2) || (f.url && f.url.hls2) || '';
  if (isLegacyTizen()) return hls2;
  const sp = getStreamingType();
  if (sp === 'hls4') return hls4;
  if (sp === 'hls2') return hls2;
  return hls4 || hls2;
}

function currentPosition(): number {
  if (seeking && seekPos >= 0) return seekPos;
  return videoEl ? videoEl.currentTime : 0;
}

function continuePlaying(next: PlayState, title?: string): void {
  const needSource = next.quality !== state.quality || next.audio !== state.audio || !videoEl;
  const needSub = next.sub !== state.sub;
  const needSeek = !needSource && Math.abs(next.position - currentPosition()) > 2;

  plog.info('continuePlaying {needSource} {needSeek} {needSub}', {
    needSource, needSeek, needSub,
    pos: next.position, quality: next.quality, audio: next.audio, sub: next.sub,
    paused: next.paused, hasVideo: !!videoEl,
  });

  state = { quality: next.quality, audio: next.audio, sub: next.sub, position: next.position, paused: next.paused };
  if (seeking) resetSeek();

  if (needSource) {
    if (currentFiles.length === 0) return;
    const f = currentFiles[state.quality];
    let hlsUrl = getHlsUrl(f);
    if (!hlsUrl) return;
    if (isProxyAll()) hlsUrl = proxyUrl(hlsUrl);
    currentHlsUrl = hlsUrl;
    const audioIndex = currentAudios.length > 0 ? currentAudios[state.audio].index : 1;
    const rewriteUrl = getRewrittenHlsUrl(hlsUrl, audioIndex);
    if (!videoEl) {
      playUrl(rewriteUrl, title || currentTitle);
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
    loadSubtitleTrack(videoEl, $root, currentSubs, state.sub);
  }
}

// --- Bar show/hide ---

let barTimer: number | null = null;
let progressTimer: number | null = null;

function startProgressTimer(): void {
  stopProgressTimer();
  progressTimer = window.setInterval(function () {
    syncProgressState();
    updateProgress($root, progressState);
  }, 1000);
}

function stopProgressTimer(): void {
  if (progressTimer !== null) { clearInterval(progressTimer); progressTimer = null; }
}

function showBar(): void {
  $root.find('.player__header, .player__gradient, .player__bar').removeClass('hidden');
  showInfo($root, getInfoState());
  syncProgressState();
  updateProgress($root, progressState);
  startProgressTimer();
  clearBarTimer();
  if (!panelState.open && !seeking) {
    barTimer = window.setTimeout(hideBar, 4000);
  }
}

function hideBar(): void {
  stopProgressTimer();
  $root.find('.player__header, .player__gradient, .player__bar').addClass('hidden');
  hideInfo($root);
}

function clearBarTimer(): void {
  if (barTimer !== null) { clearTimeout(barTimer); barTimer = null; }
}

// --- Audio / Sub / Quality switching ---

function doSavePrefs(): void {
  if (!currentItem) return;
  saveCurrentPrefs(currentItem.id, currentFiles, currentAudios, currentSubs, state.quality, state.audio, state.sub);
}



// --- Playback ---

function buildHlsConfig(): Record<string, any> {
  const cfg: Record<string, any> = {};
  if (state.position > 0) cfg.startPosition = state.position;
  cfg.maxBufferLength = 10;
  cfg.maxMaxBufferLength = 30;
  cfg.maxBufferHole = 1.0;
  cfg.highBufferWatchdogPeriod = 10;
  cfg.nudgeMaxRetry = 10;
  cfg.abrEwmaFastLive = 5.0;
  cfg.abrEwmaSlowLive = 10.0;
  cfg.abrEwmaFastVoD = 5.0;
  cfg.abrEwmaSlowVoD = 10.0;
  cfg.fragLoadingMaxRetry = 6;
  cfg.manifestLoadingMaxRetry = 3;
  cfg.levelLoadingMaxRetry = 4;
  return cfg;
}

function playSource(url: string): void {
  if (!videoEl) return;
  currentHlsUrl = url;
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
  playSourceDebug = 'url=' + url.substring(0, 120);
  const cfg = buildHlsConfig();
  plog.info('playSource startPosition={startPosition} url={url}', {
    startPosition: cfg.startPosition || 0,
    url: url.substring(0, 120),
  });
  const hls = new Hls(cfg);
  hlsInstance = hls;
  hls.on(Hls.Events.MANIFEST_PARSED, function () {
    plog.info('hls MANIFEST_PARSED');
    onSourceReady();
  });
  hls.on(Hls.Events.ERROR, function (_e: any, data: any) {
    if (!data.fatal) {
      plog.debug('hls error (non-fatal) {type} {details} {reason} {fragUrl}', {
        type: data.type, details: data.details,
        reason: data.reason || null,
        fragUrl: data.frag ? (data.frag.url || '').substring(0, 120) : null,
        fragSn: data.frag ? data.frag.sn : null,
        fragStart: data.frag ? data.frag.start : null,
      });
      // If the fragment covering our resume position can't be parsed,
      // skip past it so hls.js loads the next one.
      if (data.details === 'fragParsingError' && data.frag && videoEl
          && videoEl.readyState < 2 /* HAVE_CURRENT_DATA */) {
        const skipTo = (data.frag.start || 0) + (data.frag.duration || 10) + 0.5;
        plog.warn('skipping broken fragment, seeking to {skipTo}', { skipTo });
        videoEl.currentTime = skipTo;
      }
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
}

function safePlay(v: HTMLVideoElement): void {
  const pr = v.play();
  if (pr && typeof (pr as any).catch === 'function') {
    (pr as any).catch(function (err: Error) {
      plog.error('play() rejected {name} {message}', { name: err.name, message: err.message });
    });
  }
}


function onSourceReady(): void {
  if (!videoEl) return;
  plog.info('onSourceReady pos={pos} paused={paused}', { pos: state.position, paused: state.paused });
  if (state.position > 0) {
    // Don't play yet — wait for FRAG_BUFFERED at target position.
    // Keep setting currentTime to nudge hls.js into loading fragments near pos.
    // On Chromium 28, currentTime assignment is ignored until data is buffered,
    // but hls.js watches it to decide which fragments to fetch.
    const pos = state.position;
    const v = videoEl;
    pendingSeekPos = pos;
    const isBuffered = (time: number): boolean => {
      for (let i = 0; i < v.buffered.length; i++) {
        if (time >= v.buffered.start(i) && time <= v.buffered.end(i)) return true;
      }
      return false;
    };
    const nudgeSeek = () => {
      if (pendingSeekPos < 0 || v !== videoEl) return;
      if (isBuffered(pos)) {
        pendingSeekPos = -1;
        plog.info('data buffered at {pos}, seeking and playing', { pos });
        v.currentTime = pos;
        hideSpinner();
        if (!state.paused) safePlay(v);
        return;
      }
      v.currentTime = pos;
      plog.debug('nudgeSeek pos={pos} currentTime={ct} buffered={buffered}', {
        pos, ct: v.currentTime,
        buffered: v.buffered.length > 0 ? v.buffered.start(0) + '-' + v.buffered.end(0) : 'none',
      });
      window.setTimeout(nudgeSeek, 500);
    };
    v.currentTime = pos;
    plog.info('onSourceReady waiting for data at pos={pos}', { pos });
    window.setTimeout(nudgeSeek, 500);
  } else {
    pendingSeekPos = -1;
    plog.info('onSourceReady pos=0, playing paused={paused}', { paused: state.paused });
    if (!state.paused) safePlay(videoEl);
  }
  playbackStarted = true;
  if (state.sub >= 0 && videoEl) {
    loadSubtitleTrack(videoEl, $root, currentSubs, state.sub);
  }
  startMarkTimer();
  showBar();
  updateInfoBadge($root, getInfoState());
}

function showSpinner(): void {
  $root.find('.player__spinner').show();
}

function hideSpinner(): void {
  $root.find('.player__spinner').hide();
}

function getVideoErrorMessage(error: MediaError | null): string {
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

function showPlaybackError(error: MediaError | null, url: string, debugMsg?: string): void {
  let msg = getVideoErrorMessage(error);
  let code = error ? error.code : 0;
  const detail = error && (error as any).message ? (error as any).message : '';
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
  keys.bind(function (e: JQuery.Event) {
    const kc = getKeyCode(e);
    if (kc === TvKey.Return || kc === TvKey.Backspace || kc === TvKey.Escape) {
      goBack();
      e.preventDefault();
    }
  });
}

function playUrl(url: string, title: string): void {
  const itemTitle = title.split(' - ')[0] || title;
  const epTitle = title.indexOf(' - ') >= 0 ? title.substring(title.indexOf(' - ') + 3) : '';
  $root.html(tplPlayer({ title: itemTitle, episode: epTitle }));
  videoEl = $root.find('video')[0] as HTMLVideoElement;
  progressState.barValueEl = null;
  progressState.barPctEl = null;
  progressState.barDurationEl = null;
  progressState.barSeekEl = null;

  const sourceUrl = url;
  videoEl.addEventListener('ended', function () {
    plog.info('video ended currentTime={currentTime}', { currentTime: videoEl ? videoEl.currentTime : -1 });
    if (!markedWatched) markWatched();
    if (!navigateTrack(1)) goBack();
  });
  videoEl.addEventListener('waiting', function () {
    plog.debug('video waiting currentTime={currentTime}', { currentTime: videoEl ? videoEl.currentTime : -1 });
    showSpinner();
  });
  videoEl.addEventListener('seeking', function () {
    plog.debug('video seeking currentTime={currentTime}', { currentTime: videoEl ? videoEl.currentTime : -1 });
    showSpinner();
  });
  videoEl.addEventListener('canplay', function () {
    plog.debug('video canplay currentTime={currentTime}', { currentTime: videoEl ? videoEl.currentTime : -1 });
    hideSpinner();
  });
  videoEl.addEventListener('playing', function () {
    videoStalled = false;
    plog.info('video playing currentTime={currentTime}', { currentTime: videoEl ? videoEl.currentTime : -1 });
    hideSpinner();
  });
  videoEl.addEventListener('seeked', function () {
    plog.debug('video seeked currentTime={currentTime}', { currentTime: videoEl ? videoEl.currentTime : -1 });
    hideSpinner();
  });
  videoEl.addEventListener('stalled', function () {
    videoStalled = true;
    plog.warn('video stalled currentTime={currentTime}', { currentTime: videoEl ? videoEl.currentTime : -1 });
    showSpinner();
  });
  videoEl.addEventListener('error', function () {
    const err2 = videoEl ? videoEl.error : null;
    plog.error('video error code={code} message={message}', {
      code: err2 ? err2.code : null,
      message: err2 ? (err2 as any).message || null : null,
    });
    if (videoEl) showPlaybackError(videoEl.error, sourceUrl);
  });

  applySubSize();
  playSource(url);
}

// --- Mark time ---

let markedWatched = false;
let wasWatched = false;

function startMarkTimer(): void {
  stopMarkTimer();
  markedWatched = false;
  markTimer = window.setInterval(function () {
    if (!videoEl || !currentItem) return;
    const time = Math.floor(videoEl.currentTime);
    if (time <= 0) return;
    if (currentSeason !== undefined && currentEpisode !== undefined) {
      markTime(currentItem.id, currentEpisode, time, currentSeason);
    } else if (currentVideo !== undefined) {
      markTime(currentItem.id, currentVideo, time);
    }
    // After ~30s of playback, reset watched status so the item
    // reappears as "in progress" instead of "watched".
    if (wasWatched) {
      wasWatched = false;
      plog.info('resetting watched status after 30s of playback');
      if (currentSeason !== undefined && currentEpisode !== undefined) {
        toggleWatched(currentItem.id, currentEpisode, currentSeason);
      } else if (currentVideo !== undefined) {
        toggleWatched(currentItem.id, currentVideo);
      }
    }
    if (!markedWatched) {
      syncProgressState();
      const dur = getVideoDuration(progressState);
      if (dur > 0) {
        const isSerial = currentSeason !== undefined;
        const threshold = isSerial ? 120 : 420;
        if (dur - time <= threshold) {
          markedWatched = true;
          markWatched();
        }
      }
    }
  }, 30000);
}

function stopMarkTimer(): void {
  if (markTimer !== null) { clearInterval(markTimer); markTimer = null; }
}

function savePosition(): void {
  if (!videoEl || !currentItem) return;
  const time = Math.floor(videoEl.currentTime);
  if (time <= 0) return;
  if (currentSeason !== undefined && currentEpisode !== undefined) {
    markTime(currentItem.id, currentEpisode, time, currentSeason);
  } else if (currentVideo !== undefined) {
    markTime(currentItem.id, currentVideo, time);
  }
}

function markWatched(): void {
  if (!currentItem) return;
  if (currentSeason !== undefined && currentEpisode !== undefined) {
    toggleWatched(currentItem.id, currentEpisode, currentSeason);
  } else if (currentVideo !== undefined) {
    toggleWatched(currentItem.id, currentVideo);
  }
}

function destroyPlayer(): void {
  videoStalled = false;
  pendingSeekPos = -1;
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
  currentHlsUrl = '';
}

// --- Keys ---

function getKeyCode(e: JQuery.Event): number {
  const orig = (e as any).originalEvent as KeyboardEvent;
  return (orig && orig.keyCode) ? orig.keyCode : (e.keyCode || 0);
}

function handleKey(e: JQuery.Event): void {
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
      if (videoEl.paused || videoStalled) { videoStalled = false; safePlay(videoEl); state.paused = false; showOsd('play'); }
      else { videoEl.pause(); state.paused = true; showOsd('pause'); }
      showBar(); break;

    case TvKey.Play:
      if (videoEl.paused) { videoEl.play(); state.paused = false; showOsd('play'); showBar(); }
      break;
    case TvKey.Pause:
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
}

// --- Page ---

export var playerPage: Page = {
  mount: function (params: RouteParams) {
    currentItem = null;
    currentSeason = params.season;
    currentEpisode = params.episode;
    currentVideo = params.video;
    playbackStarted = false;
    panelState.open = false;
    panelState.listOpen = false;
    currentFiles = [];
    currentAudios = [];
    currentSubs = [];
    state = { quality: 0, audio: 0, sub: -1, position: 0, paused: false };

    showSpinnerIn($root);
    let id = params.id!;

    getItem(id).then(
      function (itemRes: any) {
        const data = Array.isArray(itemRes) ? itemRes[0] : itemRes;
        currentItem = data.item;
        if (!currentItem) return;

        let media: MediaInfo | null = null;
        let pos = 0;

        if (currentSeason !== undefined && currentEpisode !== undefined) {
          media = findEpisodeMedia(currentItem, currentSeason, currentEpisode);
          pos = getResumeTime(currentItem, currentSeason, currentEpisode);
          wasWatched = isEpisodeWatched(currentItem, currentSeason, currentEpisode);
        } else if (currentVideo !== undefined) {
          media = findVideoMedia(currentItem, currentVideo);
          pos = getResumeTime(currentItem, undefined, undefined, currentVideo);
          wasWatched = isVideoWatched(currentItem, currentVideo);
        }

        if (!media) {
          $root.html('<div class="player"><div class="player__title" style="padding:60px;">Видео не найдено</div></div>');
          return;
        }

        currentTitle = media.title;
        currentDuration = media.duration;
        currentAudios = media.audios;
        const itemTitle = currentItem.title.split(' / ')[0];
        const prefs = getTitlePrefs(currentItem.id);

        loadMediaLinks(media.mid, function (files, subs) {
          currentFiles = files.slice().sort(function (a, b) { return b.w - a.w; });
          currentSubs = subs.filter(function (s) { return s.url && !s.embed; });
          const q = restoreQualityIndex(currentFiles, prefs);
          const a = restoreAudioIndex(currentAudios, prefs);
          const s = restoreSubIndex(currentSubs, prefs);

          if (currentFiles.length === 0) {
            $root.html('<div class="player"><div class="player__title" style="padding:60px;">Видео не найдено</div></div>');
            return;
          }
          continuePlaying({ quality: q, audio: a, sub: s, position: pos, paused: false }, itemTitle + ' - ' + currentTitle);
        });
      },
      function () {
        $root.html('<div class="player"><div class="player__title" style="padding:60px;">Ошибка загрузки</div></div>');
      }
    );

    keys.bind(handleKey);
  },

  unmount: function () {
    destroyPlayer();
    keys.unbind();
    clearPage($root);
    panelState.open = false;
    panelState.listOpen = false;
  }
};
