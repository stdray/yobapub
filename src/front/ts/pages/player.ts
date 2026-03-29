import $ from 'jquery';
import { Page, RouteParams } from '../types/app';
import { getItem } from '../api/items';
import { markTime, toggleWatched } from '../api/watching';
import { Item, VideoFile, AudioTrack, Subtitle } from '../types/api';
import { goBack } from '../router';
import { TvKey, isLegacyTizen } from '../utils/platform';
import { getStreamingType, isProxyAll, proxyUrl } from '../utils/storage';
import { pageKeys, showSpinnerIn, clearPage } from '../utils/page';

import Hls from 'hls.js';
import { tplPlayer } from './player/template';
import { MediaInfo, getUrlFromFile, findEpisodeMedia, findVideoMedia, loadMediaLinks, getResumeTime } from './player/media';
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
var resumeTime = 0;

var currentFiles: VideoFile[] = [];
var currentAudios: AudioTrack[] = [];
var currentSubs: Subtitle[] = [];
var selectedQuality = 0;
var selectedAudio = 0;
var selectedSub = -1;
var currentTitle = '';
var currentDuration = 0;
var currentHlsUrl = '';
var hlsInstance: Hls | null = null;
var playSourceDebug = '';
var playbackStarted = false;
var resumePaused = false;
var qualitySwitching = false;

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
    selectedQuality: selectedQuality,
    selectedAudio: selectedAudio,
    selectedSub: selectedSub
  };
}

function hasHlsUrl(): boolean {
  if (currentFiles.length === 0) return false;
  var f = currentFiles[selectedQuality];
  return !!((f.urls && (f.urls.hls4 || f.urls.hls2)) || (f.url && (f.url.hls4 || f.url.hls2)));
}

function getPanelData(): PanelData {
  return {
    audioItems: getAudioItems(currentAudios, selectedAudio, videoEl),
    subItems: getSubItems(currentSubs, selectedSub),
    qualityItems: getQualityItems(currentFiles, selectedQuality),
    audioEnabled: currentAudios.length > 1 && hasHlsUrl(),
    subsEnabled: currentSubs.length > 0,
    qualityEnabled: currentFiles.length > 1
  };
}

var panelCallbacks: PanelCallbacks = {
  onShowBar: function () { showBar(); },
  onHideBar: function () { hideBar(); },
  onClearBarTimer: function () { clearBarTimer(); },
  onApplyAudio: function (idx) { applyAudioSwitch(idx); },
  onApplySub: function (menuIdx) { applySubSwitch(menuIdx); },
  onApplyQuality: function (idx) {
    if (idx !== selectedQuality) {
      selectedQuality = idx;
      switchQuality();
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
  videoEl.currentTime = seekPos;
  resetSeek();
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

  if (currentSeason !== undefined && currentEpisode !== undefined) {
    media = findEpisodeMedia(currentItem, currentSeason, currentEpisode);
    resumeTime = getResumeTime(currentItem, currentSeason, currentEpisode);
  } else if (currentVideo !== undefined) {
    media = findVideoMedia(currentItem, currentVideo);
    resumeTime = getResumeTime(currentItem, undefined, undefined, currentVideo);
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
    selectedQuality = restoreQualityIndex(currentFiles, prefs);
    selectedAudio = restoreAudioIndex(currentAudios, prefs);
    selectedSub = restoreSubIndex(currentSubs, prefs);

    if (currentFiles.length === 0) return;
    startWithAudio(itemTitle + ' - ' + currentTitle);
  });
}

function startWithAudio(title: string): void {
  var f = currentFiles[selectedQuality];
  var hlsUrl = (f.urls && f.urls.hls4) || (f.url && f.url.hls4) || (f.urls && f.urls.hls2) || (f.url && f.url.hls2) || '';
  if (hlsUrl) {
    if (isProxyAll()) hlsUrl = proxyUrl(hlsUrl);
    currentHlsUrl = hlsUrl;
    if (!isLegacyTizen() || selectedAudio > 0) {
      var audioIndex = currentAudios.length > 0 ? currentAudios[selectedAudio].index : 1;
      var rewriteUrl = getRewrittenHlsUrl(hlsUrl, audioIndex);
      playUrl(rewriteUrl, title);
      return;
    }
    playUrl(hlsUrl, title);
    return;
  }
  var url = getUrlFromFile(f);
  if (url) playUrl(url, title);
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
  saveCurrentPrefs(currentItem.id, currentFiles, currentAudios, currentSubs, selectedQuality, selectedAudio, selectedSub);
}

function applyAudioSwitch(idx: number): void {
  selectedAudio = idx;
  if (currentFiles.length > 0) {
    var f = currentFiles[selectedQuality];
    var hlsUrl = (f.urls && f.urls.hls4) || (f.url && f.url.hls4) || (f.urls && f.urls.hls2) || (f.url && f.url.hls2) || '';
    if (hlsUrl) {
      if (isProxyAll()) hlsUrl = proxyUrl(hlsUrl);
      switchToRewrittenHls(hlsUrl, idx);
      return;
    }
  }
  showToast('Смена аудио недоступна');
}

function switchToRewrittenHls(hlsUrl: string, audioIdx: number): void {
  var audioIndex = currentAudios[audioIdx].index;
  var pos = videoEl ? videoEl.currentTime : 0;
  var paused = videoEl ? videoEl.paused : false;
  var rewriteUrl = getRewrittenHlsUrl(hlsUrl, audioIndex);
  currentHlsUrl = hlsUrl;
  resumeTime = pos;
  resumePaused = paused;
  qualitySwitching = true;
  showSpinner();
  playSource(rewriteUrl);
  // if (isBackendRewriteAvailable()) {
  //   ...
  // } else {
  //   fetchRewrittenHls(hlsUrl, audioIndex, function (blobUrl) { ... });
  // }
}

function applySubSwitch(menuIdx: number): void {
  var subIdx = menuIdx - 1;
  selectedSub = subIdx;
  if (videoEl) loadSubtitleTrack(videoEl, $root, currentSubs, subIdx);
}

function switchQuality(): void {
  if (!videoEl || currentFiles.length === 0) return;
  var pos = videoEl.currentTime;
  resumePaused = videoEl.paused;
  var url = getUrlFromFile(currentFiles[selectedQuality]);
  if (!url) return;

  resumeTime = pos;
  qualitySwitching = true;
  playSource(url);
}

// --- Playback ---

function playSource(url: string): void {
  if (!videoEl) return;
  currentHlsUrl = url;
  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }
  var onMeta = function () {
    if (videoEl) videoEl.removeEventListener('loadedmetadata', onMeta);
    onSourceReady();
  };
  videoEl.addEventListener('loadedmetadata', onMeta);
  var isHls = url.indexOf('.m3u8') >= 0 || url.indexOf('/hls/') >= 0;
  var isTizen = typeof (window as any).tizen !== 'undefined' || /Tizen/i.test(navigator.userAgent);
  var legacyTizen = isLegacyTizen();
  var canPlayVnd = videoEl.canPlayType('application/vnd.apple.mpegurl');
  var canPlayX = videoEl.canPlayType('application/x-mpegurl');
  var hlsSupported = Hls.isSupported();
  var useHlsJs = isHls && !legacyTizen && (isTizen || !canPlayVnd) && hlsSupported;
  playSourceDebug = 'isHls=' + isHls + ' isTizen=' + isTizen + ' legacy=' + legacyTizen +
    ' vnd="' + canPlayVnd + '" x="' + canPlayX +
    '" hlsOk=' + hlsSupported + ' useHlsJs=' + useHlsJs +
    ' url=' + url.substring(0, 80);
  if (useHlsJs) {
    var hls = new Hls();
    hlsInstance = hls;
    hls.on(Hls.Events.MANIFEST_PARSED, function () {
      if (videoEl) videoEl.removeEventListener('loadedmetadata', onMeta);
      onSourceReady();
    });
    hls.on(Hls.Events.ERROR, function (_e: any, data: any) {
      if (data.fatal) showPlaybackError(null, url, 'hls fatal: type=' + data.type + ' details=' + data.details + (data.response ? ' status=' + data.response.code : ''));
    });
    hls.loadSource(url);
    hls.attachMedia(videoEl);
  } else {
    videoEl.src = url;
  }
}

function onSourceReady(): void {
  if (!videoEl) return;
  if (resumeTime > 0) {
    var pos = resumeTime;
    resumeTime = 0;
    var v = videoEl;
    var seekDone = false;
    var seekTimer: number | null = null;
    var doSeek = function () {
      if (seekDone) return;
      seekDone = true;
      if (seekTimer !== null) { clearTimeout(seekTimer); seekTimer = null; }
      v.removeEventListener('playing', doSeek);
      v.removeEventListener('canplay', doSeek);
      v.currentTime = pos;
    };
    // Tizen 2.3: 'playing' may not fire; 'canplay' is more reliable; fallback after 3s
    v.addEventListener('playing', doSeek);
    v.addEventListener('canplay', doSeek);
    seekTimer = window.setTimeout(doSeek, 3000);
    if (resumePaused) {
      resumePaused = false;
    } else {
      v.play();
    }
  } else {
    if (resumePaused) { resumePaused = false; }
    else { videoEl.play(); }
  }
  playbackStarted = true;
  qualitySwitching = false;
  if (selectedSub >= 0) {
    var subToRestore = selectedSub;
    var vv = videoEl;
    var subLoaded = false;
    var tryLoadSub = function () {
      if (subLoaded || !vv || !vv.parentNode) return;
      subLoaded = true;
      loadSubtitleTrack(vv, $root, currentSubs, subToRestore);
    };
    vv.addEventListener('timeupdate', function onTime() {
      vv.removeEventListener('timeupdate', onTime);
      tryLoadSub();
    });
    setTimeout(tryLoadSub, 3000);
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
    if (!markedWatched) markWatched();
    if (!navigateTrack(1)) goBack();
  });
  videoEl.addEventListener('waiting', showSpinner);
  videoEl.addEventListener('seeking', showSpinner);
  videoEl.addEventListener('canplay', hideSpinner);
  videoEl.addEventListener('playing', hideSpinner);
  videoEl.addEventListener('seeked', hideSpinner);
  videoEl.addEventListener('error', function () {
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
      if (videoEl.paused) { videoEl.play(); showOsd('play'); }
      else { videoEl.pause(); showOsd('pause'); }
      showBar(); break;

    case TvKey.Play:
      if (videoEl.paused) { videoEl.play(); showOsd('play'); showBar(); }
      break;
    case TvKey.Pause:
      videoEl.pause(); showOsd('pause'); showBar(); break;

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
    resumeTime = 0;
    resumePaused = false;
    playbackStarted = false;
    panelState.open = false;
    panelState.listOpen = false;
    currentFiles = [];
    currentAudios = [];
    currentSubs = [];
    selectedQuality = 0;
    selectedAudio = 0;
    selectedSub = -1;

    showSpinnerIn($root);
    var id = params.id!;

    getItem(id).then(
      function (itemRes: any) {
        var data = Array.isArray(itemRes) ? itemRes[0] : itemRes;
        currentItem = data.item;
        if (!currentItem) return;

        var media: MediaInfo | null = null;

        if (currentSeason !== undefined && currentEpisode !== undefined) {
          media = findEpisodeMedia(currentItem, currentSeason, currentEpisode);
          resumeTime = getResumeTime(currentItem, currentSeason, currentEpisode);
        } else if (currentVideo !== undefined) {
          media = findVideoMedia(currentItem, currentVideo);
          resumeTime = getResumeTime(currentItem, undefined, undefined, currentVideo);
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
          selectedQuality = restoreQualityIndex(currentFiles, prefs);
          selectedAudio = restoreAudioIndex(currentAudios, prefs);
          selectedSub = restoreSubIndex(currentSubs, prefs);

          if (currentFiles.length === 0) {
            $root.html('<div class="player"><div class="player__title" style="padding:60px;">Видео не найдено</div></div>');
            return;
          }
          startWithAudio(itemTitle + ' - ' + currentTitle);
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
