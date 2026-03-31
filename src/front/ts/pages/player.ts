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
import { MediaInfo, findEpisodeMedia, findVideoMedia, loadMediaLinks, getResumeTime } from './player/media';
import { getRewrittenHlsUrl } from './player/hls';
import { applySubSize, changeSubSize, loadSubtitleTrack } from './player/subtitles';
import { ProgressState, getVideoDuration, updateProgress } from './player/progress';
import { PanelState, PanelCallbacks, PanelData, getAudioItems, getSubItems, getQualityItems, openPanel as panelOpen_, closePanel as panelClose_, handlePanelKey, clearPanelIdle } from './player/panel';
import { restoreQualityIndex, restoreAudioIndex, restoreSubIndex, saveCurrentPrefs, getTitlePrefs } from './player/preferences';
import { InfoState, updateInfoBadge, showInfo, hideInfo } from './player/info';

var $root = $('#page-player');
var keys = pageKeys();
var markTimer: number | null = null;
var videoEl: HTMLVideoElement | null = null;


var currentItem: Item | null = null;
var currentSeason: number | undefined;
var currentEpisode: number | undefined;
var currentVideo: number | undefined;

var currentFiles: VideoFile[] = [];
var currentAudios: AudioTrack[] = [];
var currentSubs: Subtitle[] = [];
var currentTitle = '';
var currentDuration = 0;
var currentHlsUrl = '';
var hlsInstance: Hls | null = null;
var playSourceDebug = '';
var playbackStarted = false;

interface PlayState {
  quality: number;
  audio: number;
  sub: number;
  position: number;
  paused: boolean;
}

var state: PlayState = { quality: 0, audio: 0, sub: -1, position: 0, paused: false };

// --- Progress state ---

var progressState: ProgressState = {
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

var panelState: PanelState = {
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

var panelCallbacks: PanelCallbacks = {
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

var toastTimer: number | null = null;
var osdTimer: number | null = null;

function showToast(text: string): void {
  var $toast = $root.find('.player__toast');
  if ($toast.length === 0) {
    $root.find('.player').append('<div class="player__toast"></div>');
    $toast = $root.find('.player__toast');
  }
  $toast.text(text).removeClass('hidden');
  if (toastTimer !== null) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(function () { $toast.addClass('hidden'); toastTimer = null; }, 1500);
}

function showOsd(icon: string): void {
  var symbols: Record<string, string> = { play: '\u25B6', pause: '\u275A\u275A', rw: '\u23EA', ff: '\u23E9' };
  $root.find('.player__osd').text(symbols[icon] || icon).removeClass('hidden');
  if (osdTimer) clearTimeout(osdTimer);
  osdTimer = window.setTimeout(function () {
    $root.find('.player__osd').addClass('hidden');
    osdTimer = null;
  }, 700);
}

// --- Seek ---

var seekPos = -1;
var seekCount = 0;
var seekDir = '';
var seeking = false;
var seekApplyTimer: number | null = null;

function startSeek(dir: string): void {
  seeking = true;
  if (seekDir !== dir) { seekDir = dir; seekCount = 0; }
  if (seekPos === -1 && videoEl) seekPos = videoEl.currentTime;

  syncProgressState();
  var step = 10 + Math.pow(Math.min(seekCount, 3000), 3) / 1000;
  var dur = getVideoDuration(progressState);
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
  var dur = getVideoDuration(progressState);
  if (dur > 0) seekPos = Math.min(seekPos, dur - 2);
  seekPos = Math.max(0, seekPos);
  var pos = seekPos;
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
      var s = currentItem.seasons[si];
      if (s.number !== currentSeason) continue;
      for (var ei = 0; ei < s.episodes.length; ei++) {
        if (s.episodes[ei].number !== currentEpisode) continue;
        var targetIdx = ei + dir;
        if (targetIdx >= 0 && targetIdx < s.episodes.length) {
          savePosition(); destroyPlayer();
          currentEpisode = s.episodes[targetIdx].number;
          remountTrack();
          return true;
        }
        var targetSeason = si + dir;
        if (targetSeason >= 0 && targetSeason < currentItem.seasons.length) {
          var ts = currentItem.seasons[targetSeason];
          var ep = dir > 0 ? ts.episodes[0] : ts.episodes[ts.episodes.length - 1];
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
    var newVideo = currentVideo + dir;
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
  var media: MediaInfo | null = null;
  var pos = 0;

  if (currentSeason !== undefined && currentEpisode !== undefined) {
    media = findEpisodeMedia(currentItem, currentSeason, currentEpisode);
    pos = getResumeTime(currentItem, currentSeason, currentEpisode);
  } else if (currentVideo !== undefined) {
    media = findVideoMedia(currentItem, currentVideo);
    pos = getResumeTime(currentItem, undefined, undefined, currentVideo);
  }

  if (!media) return;

  var itemTitle = currentItem.title.split(' / ')[0];
  currentTitle = media.title;
  currentDuration = media.duration;
  currentAudios = media.audios;
  var prefs = currentItem ? getTitlePrefs(currentItem.id) : null;

  loadMediaLinks(media.mid, function (files, subs) {
    currentFiles = files.slice().sort(function (a, b) { return b.w - a.w; });
    currentSubs = subs.filter(function (s) { return s.url && !s.embed; });
    var q = restoreQualityIndex(currentFiles, prefs);
    var a = restoreAudioIndex(currentAudios, prefs);
    var s = restoreSubIndex(currentSubs, prefs);

    if (currentFiles.length === 0) return;
    continuePlaying({ quality: q, audio: a, sub: s, position: pos, paused: false }, itemTitle + ' - ' + currentTitle);
  });
}

function getHlsUrl(f: VideoFile): string {
  var hls4 = (f.urls && f.urls.hls4) || (f.url && f.url.hls4) || '';
  var hls2 = (f.urls && f.urls.hls2) || (f.url && f.url.hls2) || '';
  if (isLegacyTizen()) return hls2;
  var sp = getStreamingType();
  if (sp === 'hls4') return hls4;
  if (sp === 'hls2') return hls2;
  return hls4 || hls2;
}

function currentPosition(): number {
  if (seeking && seekPos >= 0) return seekPos;
  return videoEl ? videoEl.currentTime : 0;
}

function continuePlaying(next: PlayState, title?: string): void {
  var needSource = next.quality !== state.quality || next.audio !== state.audio || !videoEl;
  var needSub = next.sub !== state.sub;
  var needSeek = !needSource && Math.abs(next.position - currentPosition()) > 2;

  plog.info('continuePlaying {needSource} {needSeek} {needSub}', {
    needSource, needSeek, needSub,
    pos: next.position, quality: next.quality, audio: next.audio, sub: next.sub,
    paused: next.paused, hasVideo: !!videoEl,
  });

  state = { quality: next.quality, audio: next.audio, sub: next.sub, position: next.position, paused: next.paused };
  if (seeking) resetSeek();

  if (needSource) {
    if (currentFiles.length === 0) return;
    var f = currentFiles[state.quality];
    var hlsUrl = getHlsUrl(f);
    if (!hlsUrl) return;
    if (isProxyAll()) hlsUrl = proxyUrl(hlsUrl);
    currentHlsUrl = hlsUrl;
    var audioIndex = currentAudios.length > 0 ? currentAudios[state.audio].index : 1;
    var rewriteUrl = getRewrittenHlsUrl(hlsUrl, audioIndex);
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

var barTimer: number | null = null;
var progressTimer: number | null = null;

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
  var cfg: Record<string, any> = {};
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
  var cfg = buildHlsConfig();
  plog.info('playSource startPosition={startPosition} url={url}', {
    startPosition: cfg.startPosition || 0,
    url: url.substring(0, 120),
  });
  var hls = new Hls(cfg);
  hlsInstance = hls;
  hls.on(Hls.Events.MANIFEST_PARSED, function () {
    plog.info('hls MANIFEST_PARSED');
    onSourceReady();
  });
  hls.on(Hls.Events.ERROR, function (_e: any, data: any) {
    if (!data.fatal) {
      plog.debug('hls error (non-fatal) {type} {details}', { type: data.type, details: data.details });
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

function onSourceReady(): void {
  if (!videoEl) return;
  plog.info('onSourceReady pos={pos} paused={paused}', { pos: state.position, paused: state.paused });
  if (state.position > 0) {
    var pos = state.position;
    var v = videoEl;
    var seekDone = false;
    var seekTimer: number | null = null;
    var doSeek = function (trigger: string) {
      plog.debug('doSeek trigger={trigger} seekDone={seekDone} currentTime={currentTime} target={target}', {
        trigger, seekDone, currentTime: v.currentTime, target: pos,
      });
      if (seekDone) return;
      seekDone = true;
      if (seekTimer !== null) { clearTimeout(seekTimer); seekTimer = null; }
      v.removeEventListener('playing', doSeekPlaying);
      v.removeEventListener('canplay', doSeekCanplay);
      if (Math.abs(v.currentTime - pos) > 2) {
        // On Tizen 2.3 (Chromium 28) canplay fires before the fragment at pos is
        // buffered, so the first seek may be silently ignored. Retry until it lands.
        var retries = 0;
        var attemptSeek = function () {
          var diff = Math.abs(v.currentTime - pos);
          plog.debug('attemptSeek retry={retries} currentTime={currentTime} target={target} diff={diff}', {
            retries, currentTime: v.currentTime, target: pos, diff,
          });
          if (diff <= 2 || retries >= 3) {
            plog.info('attemptSeek done retries={retries} currentTime={currentTime} success={success}', {
              retries, currentTime: v.currentTime, success: diff <= 2,
            });
            hideSpinner();
            if (v.paused && !state.paused) {
              plog.info('attemptSeek resuming play after seek');
              v.play();
            }
            return;
          }
          retries++;
          v.currentTime = pos;
          window.setTimeout(attemptSeek, 500);
        };
        attemptSeek();
      } else {
        plog.info('doSeek: already at position, no seek needed currentTime={currentTime}', { currentTime: v.currentTime });
        hideSpinner();
        if (v.paused && !state.paused) {
          plog.info('doSeek resuming play (was paused after source load)');
          v.play();
        }
      }
    };
    var doSeekPlaying = function () { doSeek('playing'); };
    var doSeekCanplay = function () { doSeek('canplay'); };
    v.addEventListener('playing', doSeekPlaying);
    v.addEventListener('canplay', doSeekCanplay);
    seekTimer = window.setTimeout(function () { doSeek('timeout-3s'); }, 3000);
    plog.info('onSourceReady calling play paused={paused}', { paused: state.paused });
    if (!state.paused) {
      var playResult = v.play();
      if (playResult && typeof (playResult as any).catch === 'function') {
        (playResult as any).catch(function (err: Error) {
          plog.error('play() rejected {name} {message}', { name: err.name, message: err.message });
        });
      }
    }
  } else {
    plog.info('onSourceReady no resume pos, calling play paused={paused}', { paused: state.paused });
    if (!state.paused) {
      var playResult2 = videoEl.play();
      if (playResult2 && typeof (playResult2 as any).catch === 'function') {
        (playResult2 as any).catch(function (err: Error) {
          plog.error('play() rejected {name} {message}', { name: err.name, message: err.message });
        });
      }
    }
  }
  playbackStarted = true;
  if (state.sub >= 0 && videoEl) {
    loadSubtitleTrack(videoEl, $root, currentSubs, state.sub);
  }
  hideSpinner();
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
  var msg = getVideoErrorMessage(error);
  var code = error ? error.code : 0;
  var detail = error && (error as any).message ? (error as any).message : '';
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
    var kc = getKeyCode(e);
    if (kc === TvKey.Return || kc === TvKey.Backspace || kc === TvKey.Escape) {
      goBack();
      e.preventDefault();
    }
  });
}

function playUrl(url: string, title: string): void {
  var itemTitle = title.split(' - ')[0] || title;
  var epTitle = title.indexOf(' - ') >= 0 ? title.substring(title.indexOf(' - ') + 3) : '';
  $root.html(tplPlayer({ title: itemTitle, episode: epTitle }));
  videoEl = $root.find('video')[0] as HTMLVideoElement;
  progressState.barValueEl = null;
  progressState.barPctEl = null;
  progressState.barDurationEl = null;
  progressState.barSeekEl = null;

  var sourceUrl = url;
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
    plog.info('video playing currentTime={currentTime}', { currentTime: videoEl ? videoEl.currentTime : -1 });
    hideSpinner();
  });
  videoEl.addEventListener('seeked', function () {
    plog.debug('video seeked currentTime={currentTime}', { currentTime: videoEl ? videoEl.currentTime : -1 });
    hideSpinner();
  });
  videoEl.addEventListener('stalled', function () {
    plog.warn('video stalled currentTime={currentTime}', { currentTime: videoEl ? videoEl.currentTime : -1 });
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

var markedWatched = false;

function startMarkTimer(): void {
  stopMarkTimer();
  markedWatched = false;
  markTimer = window.setInterval(function () {
    if (!videoEl || !currentItem) return;
    var time = Math.floor(videoEl.currentTime);
    if (time <= 0) return;
    if (currentSeason !== undefined && currentEpisode !== undefined) {
      markTime(currentItem.id, currentEpisode, time, currentSeason);
    } else if (currentVideo !== undefined) {
      markTime(currentItem.id, currentVideo, time);
    }
    if (!markedWatched) {
      syncProgressState();
      var dur = getVideoDuration(progressState);
      if (dur > 0) {
        var isSerial = currentSeason !== undefined;
        var threshold = isSerial ? 120 : 420;
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
  var time = Math.floor(videoEl.currentTime);
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
  var orig = (e as any).originalEvent as KeyboardEvent;
  return (orig && orig.keyCode) ? orig.keyCode : (e.keyCode || 0);
}

function handleKey(e: JQuery.Event): void {
  var kc = getKeyCode(e);
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
      if (videoEl.paused) { videoEl.play(); state.paused = false; showOsd('play'); }
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
    var id = params.id!;

    getItem(id).then(
      function (itemRes: any) {
        var data = Array.isArray(itemRes) ? itemRes[0] : itemRes;
        currentItem = data.item;
        if (!currentItem) return;

        var media: MediaInfo | null = null;
        var pos = 0;

        if (currentSeason !== undefined && currentEpisode !== undefined) {
          media = findEpisodeMedia(currentItem, currentSeason, currentEpisode);
          pos = getResumeTime(currentItem, currentSeason, currentEpisode);
        } else if (currentVideo !== undefined) {
          media = findVideoMedia(currentItem, currentVideo);
          pos = getResumeTime(currentItem, undefined, undefined, currentVideo);
        }

        if (!media) {
          $root.html('<div class="player"><div class="player__title" style="padding:60px;">Видео не найдено</div></div>');
          return;
        }

        currentTitle = media.title;
        currentDuration = media.duration;
        currentAudios = media.audios;
        var itemTitle = currentItem.title.split(' / ')[0];
        var prefs = getTitlePrefs(currentItem.id);

        loadMediaLinks(media.mid, function (files, subs) {
          currentFiles = files.slice().sort(function (a, b) { return b.w - a.w; });
          currentSubs = subs.filter(function (s) { return s.url && !s.embed; });
          var q = restoreQualityIndex(currentFiles, prefs);
          var a = restoreAudioIndex(currentAudios, prefs);
          var s = restoreSubIndex(currentSubs, prefs);

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
