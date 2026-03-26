import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { getItem } from '../api/items';
import { markTime } from '../api/watching';
import { apiGet } from '../api/client';
import { Item, VideoFile, AudioTrack, Subtitle } from '../types/api';
import { goBack } from '../router';
import { TvKey, isLegacyTizen } from '../utils/platform';
import { getDefaultQuality, setDefaultQuality, QUALITY_OPTIONS, getSubSize, setSubSize, SUB_SIZE_STEP, SUB_SIZE_MIN, SUB_SIZE_MAX, getStreamingType } from '../utils/storage';

var $root = $('#page-player');
var keyHandler: ((e: JQuery.Event) => void) | null = null;
var markTimer: number | null = null;
var videoEl: HTMLVideoElement | null = null;
var hlsInstance: any = null;

var currentItem: Item | null = null;
var currentSeason: number | undefined;
var currentEpisode: number | undefined;
var currentVideo: number | undefined;
var resumeTime = 0;

var currentFiles: VideoFile[] = [];
var currentAudios: AudioTrack[] = [];

var barValueEl: HTMLElement | null = null;
var barDurationEl: HTMLElement | null = null;
var barSeekEl: HTMLElement | null = null;
var currentSubs: Subtitle[] = [];
var selectedQuality = 0;
var selectedAudio = 0;
var selectedSub = -1;
var currentTitle = '';
var hlsAudioTracks: any[] = [];
var hlsSubTracks: any[] = [];
var useHls = false;
var playbackStarted = false;

function formatTime(sec: number): string {
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = Math.floor(sec % 60);
  var pad = function (n: number) { return n < 10 ? '0' + n : '' + n; };
  if (h > 0) return h + ':' + pad(m) + ':' + pad(s);
  return pad(m) + ':' + pad(s);
}

function getUrlFromFile(f: VideoFile): string {
  var urls = f.urls || f.url;
  if (!urls) return '';
  var pref = getStreamingType();
  if (pref === 'http' && urls.http) return urls.http;
  if (pref === 'hls' && urls.hls) return urls.hls;
  if (pref === 'hls2' && urls.hls2) return urls.hls2;
  if (pref === 'hls4' && urls.hls4) return urls.hls4;
  return urls.hls4 || urls.hls || urls.http || '';
}

interface MediaInfo {
  mid: number;
  title: string;
  audios: AudioTrack[];
}

function findEpisodeMedia(item: Item, seasonNum: number, epNum: number): MediaInfo | null {
  if (!item.seasons) return null;
  for (var i = 0; i < item.seasons.length; i++) {
    var s = item.seasons[i];
    if (s.number === seasonNum) {
      for (var j = 0; j < s.episodes.length; j++) {
        var ep = s.episodes[j];
        if (ep.number === epNum) {
          return { mid: ep.id, title: ep.title || 'S' + seasonNum + 'E' + epNum, audios: ep.audios || [] };
        }
      }
    }
  }
  return null;
}

function findVideoMedia(item: Item, videoNum: number): MediaInfo | null {
  if (!item.videos) return null;
  var idx = videoNum - 1;
  if (idx >= 0 && idx < item.videos.length) {
    var v = item.videos[idx];
    return { mid: v.id, title: v.title || 'Видео ' + videoNum, audios: v.audios || [] };
  }
  return null;
}

function loadMediaLinks(mid: number, cb: (files: VideoFile[], subs: Subtitle[]) => void): void {
  apiGet('/v1/items/media-links', { mid: mid }).then(
    function (res: any) {
      var data = Array.isArray(res) ? res[0] : res;
      var files: VideoFile[] = (data && data.files) || [];
      var subs: Subtitle[] = (data && data.subtitles) || [];
      cb(files, subs);
    },
    function () { cb([], []); }
  );
}

function pickDefaultQualityIndex(files: VideoFile[]): number {
  var savedId = getDefaultQuality();
  if (savedId === -1) {
    savedId = isLegacyTizen() ? 3 : 0;
    setDefaultQuality(savedId);
  }
  if (savedId === 0 || files.length === 0) return 0;
  var maxH = 0;
  for (var q = 0; q < QUALITY_OPTIONS.length; q++) {
    if (QUALITY_OPTIONS[q].id === savedId) { maxH = QUALITY_OPTIONS[q].maxH; break; }
  }
  if (maxH === 0) return 0;
  for (var i = 0; i < files.length; i++) {
    if (files[i].h <= maxH) return i;
  }
  return files.length - 1;
}

function getResumeTime(item: Item, seasonNum?: number, epNum?: number, videoNum?: number): number {
  if (seasonNum !== undefined && epNum !== undefined && item.seasons) {
    for (var i = 0; i < item.seasons.length; i++) {
      var s = item.seasons[i];
      if (s.number === seasonNum) {
        for (var j = 0; j < s.episodes.length; j++) {
          var ep = s.episodes[j];
          if (ep.number === epNum && ep.watching) {
            var t = ep.watching.time;
            if (t > 0 && ep.duration && t < ep.duration - 10) return t;
          }
        }
      }
    }
  } else if (videoNum !== undefined && item.videos) {
    var vi = videoNum - 1;
    if (vi >= 0 && vi < item.videos.length) {
      var v = item.videos[vi];
      if (v.watching && v.watching.time > 0 && v.duration && v.watching.time < v.duration - 10) return v.watching.time;
    }
  }
  return 0;
}

// --- Templates ---

var tplPlayer = doT.template(
  '<div class="player">' +
    '<video></video>' +
    '<div class="player__spinner"><div class="spinner__circle"></div></div>' +
    '<div class="player__info hidden"></div>' +
    '<div class="player__osd hidden"></div>' +
    '<div class="player__gradient hidden"></div>' +
    '<div class="player__header hidden">' +
      '<div class="player__title">{{=it.title}}</div>' +
      '<div class="player__episode">{{=it.episode}}</div>' +
    '</div>' +
    '<div class="player__bar hidden">' +
      '<div class="player__bar-wrap">' +
        '<div class="player__bar-progress">' +
          '<div class="player__bar-value">' +
            '<div class="player__bar-dot">' +
              '<div class="player__bar-seek"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="player__bar-duration"></div>' +
      '</div>' +

    '</div>' +
    '<div class="player__panel hidden">' +
      '<div class="ppanel__overlay"></div>' +
      '<div class="ppanel__buttons">' +
        '<div class="ppanel__btn ppanel__btn--audio">' +
          '<span class="ppanel__btn-label">&#127911; ...</span>' +
        '</div>' +
        '<div class="ppanel__btn ppanel__btn--subs">' +
          '<span class="ppanel__btn-label">&#128196; ...</span>' +
        '</div>' +
        '<div class="ppanel__btn ppanel__btn--quality">' +
          '<span class="ppanel__btn-label">&#9881; ...</span>' +
        '</div>' +
      '</div>' +
      '<div class="ppanel__list hidden"></div>' +
    '</div>' +
    '<div class="player__toast hidden"></div>' +
  '</div>'
);

// --- Info badge ---

function getStreamInfo(): string {
  var parts: string[] = [];

  // stream type
  parts.push(getStreamingType().toUpperCase());

  // quality
  if (currentFiles.length > 0 && selectedQuality < currentFiles.length) {
    var f = currentFiles[selectedQuality];
    var ql = f.quality || (f.h + 'p');
    parts.push(ql + ' ' + f.w + '\u00d7' + f.h);
    if (f.codec) parts.push(f.codec.toUpperCase());
  }

  // audio
  if (currentAudios.length > 0 && selectedAudio < currentAudios.length) {
    var a = currentAudios[selectedAudio];
    var albl = a.lang;
    if (a.author && a.author.title) albl += ' (' + a.author.title + ')';
    albl += ' ' + a.codec + ' ' + a.channels + 'ch';
    parts.push(albl);
  } else if (useHls && hlsAudioTracks.length > 0) {
    var ht = hlsAudioTracks[selectedAudio] || hlsAudioTracks[0];
    parts.push(ht.name || ht.lang || 'Audio');
  }

  // subs
  if (selectedSub >= 0) {
    var tracks = getVideoTextTracks();
    if (tracks && selectedSub < tracks.length) {
      parts.push('Sub: ' + (tracks[selectedSub].label || tracks[selectedSub].language || '?'));
    } else if (selectedSub < currentSubs.length) {
      parts.push('Sub: ' + currentSubs[selectedSub].lang.toUpperCase());
    }
  }

  // bitrate from HLS
  if (useHls && hlsInstance) {
    var level = hlsInstance.levels && hlsInstance.levels[hlsInstance.currentLevel];
    if (level && level.bitrate) {
      var mbps = (level.bitrate / 1000000).toFixed(1);
      parts.push(mbps + ' Mbps');
    }
  }

  return parts.join(' &bull; ');
}

function updateInfoBadge(): void {
  var $info = $root.find('.player__info');
  $info.html(getStreamInfo());
}

function showInfo(): void {
  var $info = $root.find('.player__info');
  updateInfoBadge();
  $info.removeClass('hidden');
}

function hideInfo(): void {
  $root.find('.player__info').addClass('hidden');
}

// --- Subtitle size ---

var subStyleEl: HTMLStyleElement | null = null;
var toastTimer: number | null = null;

function applySubSize(): void {
  var size = getSubSize();
  if (!subStyleEl) {
    subStyleEl = document.createElement('style');
    document.head.appendChild(subStyleEl);
  }
  subStyleEl.textContent = 'video::cue { font-size: ' + size + 'px !important; }';
}

function changeSubSize(dir: number): void {
  var size = getSubSize();
  size = Math.max(SUB_SIZE_MIN, Math.min(SUB_SIZE_MAX, size + dir * SUB_SIZE_STEP));
  setSubSize(size);
  applySubSize();
  showToast('Субтитры: ' + size + 'px');
}

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

// --- OSD icon ---

var osdTimer: number | null = null;

function showOsd(icon: string): void {
  var symbols: Record<string, string> = { play: '\u25B6', pause: '\u275A\u275A', rw: '\u23EA', ff: '\u23E9' };
  $root.find('.player__osd').text(symbols[icon] || icon).removeClass('hidden');
  if (osdTimer) clearTimeout(osdTimer);
  osdTimer = window.setTimeout(function () {
    $root.find('.player__osd').addClass('hidden');
    osdTimer = null;
  }, 700);
}

// --- Accelerating seek ---

var seekPos = -1;
var seekCount = 0;
var seekDir = '';
var seeking = false;
var seekApplyTimer: number | null = null;

function getVideoDuration(): number {
  if (!videoEl) return 0;
  var d = videoEl.duration;
  if (!d || isNaN(d) || !isFinite(d)) return 0;
  return d;
}

function startSeek(dir: string): void {
  seeking = true;
  if (seekDir !== dir) { seekDir = dir; seekCount = 0; }
  if (seekPos === -1 && videoEl) seekPos = videoEl.currentTime;

  var step = 10 + Math.pow(Math.min(seekCount, 3000), 3) / 1000;
  var dur = getVideoDuration();
  seekPos += dir === 'right' ? step : -step;
  seekPos = Math.max(0, dur > 0 ? Math.min(seekPos, dur - 2) : seekPos);
  seekCount++;

  updateProgress();
  showOsd(dir === 'right' ? 'ff' : 'rw');
  showBar();

  if (seekApplyTimer) clearTimeout(seekApplyTimer);
  seekApplyTimer = window.setTimeout(applySeek, 2000);
}

function applySeek(): void {
  if (!seeking || seekPos < 0 || !videoEl) return;
  var dur = getVideoDuration();
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

  currentAudios = media.audios;

  loadMediaLinks(media.mid, function (files, subs) {
    currentFiles = files.slice().sort(function (a, b) { return b.w - a.w; });
    currentSubs = subs.filter(function (s) { return s.url && !s.embed; });
    selectedQuality = pickDefaultQualityIndex(currentFiles);
    selectedAudio = 0;
    selectedSub = -1;

    if (currentFiles.length === 0) return;
    var url = getUrlFromFile(currentFiles[selectedQuality]);
    if (url) {
      playUrl(url, itemTitle + ' - ' + currentTitle);
    }
  });
}

// --- Bar show/hide ---

var barTimer: number | null = null;


var progressTimer: number | null = null;

function startProgressTimer(): void {
  stopProgressTimer();
  progressTimer = window.setInterval(updateProgress, 1000);
}

function stopProgressTimer(): void {
  if (progressTimer !== null) { clearInterval(progressTimer); progressTimer = null; }
}

function showBar(): void {
  $root.find('.player__header, .player__gradient, .player__bar').removeClass('hidden');
  showInfo();
  updateProgress();
  startProgressTimer();
  clearBarTimer();
  if (!panelOpen && !seeking) {
    barTimer = window.setTimeout(hideBar, 4000);
  }
}

function hideBar(): void {
  stopProgressTimer();
  $root.find('.player__header, .player__gradient, .player__bar').addClass('hidden');
  hideInfo();
}

function clearBarTimer(): void {
  if (barTimer !== null) { clearTimeout(barTimer); barTimer = null; }
}

function cacheBarElements(): void {
  if (!barValueEl) barValueEl = $root.find('.player__bar-value')[0] || null;
  if (!barDurationEl) barDurationEl = $root.find('.player__bar-duration')[0] || null;
  if (!barSeekEl) barSeekEl = $root.find('.player__bar-seek')[0] || null;
}

function updateProgress(): void {
  if (!videoEl) return;
  cacheBarElements();
  var cur = seeking ? seekPos : videoEl.currentTime;
  var dur = getVideoDuration();
  if (cur < 0) cur = 0;
  var pct = dur > 0 ? (cur / dur) * 100 : 0;
  if (pct > 100) pct = 100;
  if (barValueEl) {
    barValueEl.style.width = pct + '%';
  }
  if (barDurationEl) {
    barDurationEl.textContent = formatTime(cur) + (dur > 0 ? ' / ' + formatTime(dur) : '');
  }
  if (barSeekEl) {
    barSeekEl.textContent = seeking ? formatTime(seekPos) : '';
  }
}



// --- Subtitles ---

function loadSubtitleTrack(subIdx: number): void {
  if (!videoEl) return;
  // remove existing tracks
  $root.find('video track').remove();
  var tracks = videoEl.textTracks;
  for (var i = 0; i < tracks.length; i++) {
    tracks[i].mode = 'disabled';
  }

  if (subIdx < 0 || subIdx >= currentSubs.length) return;

  var sub = currentSubs[subIdx];
  var track = document.createElement('track');
  track.kind = 'subtitles';
  track.label = sub.lang;
  track.srclang = sub.lang;
  track.src = sub.url;
  track.setAttribute('default', '');
  videoEl.appendChild(track);

  // activate after adding
  setTimeout(function () {
    if (videoEl && videoEl.textTracks.length > 0) {
      videoEl.textTracks[videoEl.textTracks.length - 1].mode = 'showing';
    }
  }, 100);
}

// --- Panel (settings bottom) ---

var panelOpen = false;
var panelBtnIndex = 0;
var panelListOpen = false;
var panelListIndex = 0;
var panelListSection = 0; // 0=audio, 1=subs, 2=quality

var PANEL_SECTIONS = ['audio', 'subs', 'quality'];

function buildAudioLabel(a: AudioTrack): string {
  var label = a.lang;
  if (a.type && a.type.title) label += ' - ' + a.type.title;
  if (a.author && a.author.title) label += ' (' + a.author.title + ')';
  label += ' [' + a.codec + ' ' + a.channels + 'ch]';
  return label;
}

function getAudioItems(): Array<{ label: string; selected: boolean }> {
  var items: Array<{ label: string; selected: boolean }> = [];
  if (currentAudios.length > 0) {
    for (var j = 0; j < currentAudios.length; j++) {
      items.push({ label: buildAudioLabel(currentAudios[j]), selected: j === selectedAudio });
    }
    return items;
  }
  if (useHls && hlsAudioTracks.length > 1) {
    var seen: Record<string, boolean> = {};
    for (var i = 0; i < hlsAudioTracks.length; i++) {
      var at = hlsAudioTracks[i];
      var lbl = at.name || at.lang || ('\u0414\u043E\u0440\u043E\u0436\u043A\u0430 ' + (i + 1));
      if (seen[lbl]) { lbl += ' #' + (i + 1); }
      seen[lbl] = true;
      items.push({ label: lbl, selected: i === selectedAudio });
    }
    return items;
  }
  if (videoEl) {
    var native = (videoEl as any).audioTracks;
    if (native && native.length > 0) {
      for (var k = 0; k < native.length; k++) {
        items.push({ label: native[k].label || native[k].language || ('\u0414\u043E\u0440\u043E\u0436\u043A\u0430 ' + (k + 1)), selected: native[k].enabled });
      }
      return items;
    }
  }
  items.push({ label: '\u041D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445', selected: false });
  return items;
}

function getVideoTextTracks(): TextTrackList | null {
  if (videoEl && videoEl.textTracks && videoEl.textTracks.length > 0) {
    return videoEl.textTracks;
  }
  return null;
}

function getSubItems(): Array<{ label: string; selected: boolean }> {
  var items: Array<{ label: string; selected: boolean }> = [];
  var tracks = getVideoTextTracks();
  if (tracks && tracks.length > 0) {
    items.push({ label: '\u0412\u044B\u043A\u043B', selected: selectedSub === -1 });
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      var label = (t.label || t.language || '\u0421\u0443\u0431\u0442\u0438\u0442\u0440\u044B ' + (i + 1));
      if (label.length <= 3) label = label.toUpperCase();
      items.push({ label: label, selected: i === selectedSub });
    }
    return items;
  }
  if (currentSubs.length > 0) {
    items.push({ label: '\u0412\u044B\u043A\u043B', selected: selectedSub === -1 });
    for (var j = 0; j < currentSubs.length; j++) {
      items.push({ label: currentSubs[j].lang.toUpperCase(), selected: j === selectedSub });
    }
    return items;
  }
  items.push({ label: '\u041D\u0435\u0442 \u0441\u0443\u0431\u0442\u0438\u0442\u0440\u043E\u0432', selected: false });
  return items;
}

function getQualityItems(): Array<{ label: string; selected: boolean }> {
  var items: Array<{ label: string; selected: boolean }> = [];
  for (var i = 0; i < currentFiles.length; i++) {
    var f = currentFiles[i];
    items.push({ label: f.quality + ' (' + f.w + 'x' + f.h + ')', selected: i === selectedQuality });
  }
  return items;
}

function getPanelItems(section: number): Array<{ label: string; selected: boolean }> {
  if (section === 0) return getAudioItems();
  if (section === 1) return getSubItems();
  return getQualityItems();
}

function getSelectedLabel(section: number): string {
  var items = getPanelItems(section);
  for (var i = 0; i < items.length; i++) {
    if (items[i].selected) return items[i].label;
  }
  return '...';
}

function updatePanelButtons(): void {
  var icons = ['\uD83C\uDFA7', '\uD83D\uDCC4', '\u2699'];
  for (var i = 0; i < PANEL_SECTIONS.length; i++) {
    var $btn = $root.find('.ppanel__btn').eq(i);
    $btn.find('.ppanel__btn-label').html(icons[i] + ' ' + getSelectedLabel(i));
    if (i === panelBtnIndex && !panelListOpen) {
      $btn.addClass('focused');
    } else {
      $btn.removeClass('focused');
    }
  }
}

function renderPanelList(): void {
  var items = getPanelItems(panelListSection);
  var html = '';
  for (var i = 0; i < items.length; i++) {
    html += '<div class="ppanel__list-item' +
      (items[i].selected ? ' selected' : '') +
      (i === panelListIndex ? ' focused' : '') +
      '">' + items[i].label + '</div>';
  }
  $root.find('.ppanel__list').html(html);
}

function openPanel(): void {
  if (panelOpen) return;
  panelOpen = true;
  panelBtnIndex = 0;
  panelListOpen = false;
  clearBarTimer();
  hideBar();
  $root.find('.player__panel').removeClass('hidden');
  updatePanelButtons();
  setTimeout(function () {
    $root.find('.ppanel__buttons').addClass('active');
  }, 20);
}

function closePanel(): void {
  if (!panelOpen) return;
  if (panelListOpen) {
    closePanelList();
    return;
  }
  $root.find('.ppanel__buttons').removeClass('active');
  setTimeout(function () {
    panelOpen = false;
    $root.find('.player__panel').addClass('hidden');
    showBar();
  }, 200);
}

function openPanelList(): void {
  panelListOpen = true;
  panelListSection = panelBtnIndex;
  var items = getPanelItems(panelListSection);
  panelListIndex = 0;
  for (var i = 0; i < items.length; i++) {
    if (items[i].selected) { panelListIndex = i; break; }
  }
  renderPanelList();
  updatePanelButtons();
  $root.find('.ppanel__buttons').removeClass('active');
  $root.find('.ppanel__list').removeClass('hidden');
  setTimeout(function () {
    $root.find('.ppanel__list').addClass('active');
  }, 20);
}

function closePanelList(): void {
  $root.find('.ppanel__list').removeClass('active');
  setTimeout(function () {
    panelListOpen = false;
    $root.find('.ppanel__list').addClass('hidden');
    $root.find('.ppanel__buttons').addClass('active');
    updatePanelButtons();
  }, 200);
}

function applyPanelSelection(): void {
  if (panelListSection === 0) {
    applyAudioSwitch(panelListIndex);
  } else if (panelListSection === 1) {
    applySubSwitch(panelListIndex);
  } else {
    if (panelListIndex !== selectedQuality) {
      selectedQuality = panelListIndex;
      switchQuality();
    }
  }
  updatePanelButtons();
  renderPanelList();
}

function applyAudioSwitch(idx: number): void {
  selectedAudio = idx;
  if (useHls && hlsInstance && hlsAudioTracks.length > 1) {
    hlsInstance.audioTrack = idx;
    return;
  }
  if (videoEl) {
    var native = (videoEl as any).audioTracks;
    if (native && native.length > 0) {
      for (var i = 0; i < native.length; i++) {
        native[i].enabled = (i === idx);
      }
    }
  }
}

function applySubSwitch(menuIdx: number): void {
  var subIdx = menuIdx - 1;
  selectedSub = subIdx;
  var tracks = getVideoTextTracks();
  if (tracks && tracks.length > 0) {
    for (var i = 0; i < tracks.length; i++) {
      tracks[i].mode = (i === subIdx) ? 'showing' : 'disabled';
    }
    return;
  }
  if (currentSubs.length > 0) {
    loadSubtitleTrack(subIdx);
    return;
  }
}

function handlePanelKey(e: JQuery.Event): void {
  var kc = getKeyCode(e);
  if (panelListOpen) {
    var items = getPanelItems(panelListSection);
    switch (kc) {
      case TvKey.Up:
        if (panelListIndex > 0) { panelListIndex--; renderPanelList(); }
        e.preventDefault(); break;
      case TvKey.Down:
        if (panelListIndex < items.length - 1) { panelListIndex++; renderPanelList(); }
        e.preventDefault(); break;
      case TvKey.Enter:
        if (items[panelListIndex] && items[panelListIndex].selected) { closePanelList(); }
        else { applyPanelSelection(); }
        e.preventDefault(); break;
      case TvKey.Return: case TvKey.Backspace: case TvKey.Escape:
        closePanelList(); e.preventDefault(); break;
    }
    return;
  }

  switch (kc) {
    case TvKey.Left:
      if (panelBtnIndex > 0) { panelBtnIndex--; updatePanelButtons(); }
      e.preventDefault(); break;
    case TvKey.Right:
      if (panelBtnIndex < PANEL_SECTIONS.length - 1) { panelBtnIndex++; updatePanelButtons(); }
      e.preventDefault(); break;
    case TvKey.Enter:
      openPanelList(); e.preventDefault(); break;
    case TvKey.Return: case TvKey.Backspace: case TvKey.Escape: case TvKey.Up:
      closePanel(); e.preventDefault(); break;
  }
}

var resumePaused = false;
var qualitySwitching = false;

function switchQuality(): void {
  if (!videoEl || currentFiles.length === 0) return;
  var pos = videoEl.currentTime;
  resumePaused = videoEl.paused;
  var url = getUrlFromFile(currentFiles[selectedQuality]);
  if (!url) return;

  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }

  resumeTime = pos;
  qualitySwitching = true;
  playSource(url);
}

// --- Playback ---

function playSource(url: string): void {
  if (!videoEl) return;
  useHls = false;
  hlsAudioTracks = [];
  hlsSubTracks = [];

  if (url.indexOf('.m3u8') !== -1 || url.indexOf('/hls') !== -1) {
    try {
      var Hls = require('hls.js');
      if (Hls.default) Hls = Hls.default;
      if (Hls.isSupported()) {
        useHls = true;
        hlsInstance = new Hls({
          enableWorker: false,
          renderTextTracksNatively: true,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          maxBufferSize: 30 * 1000 * 1000,
          maxBufferHole: 0.5
        });
        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(videoEl);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, function (_ev: any, _data: any) {
          hlsAudioTracks = hlsInstance.audioTracks || [];
          hlsSubTracks = hlsInstance.subtitleTracks || [];
          onSourceReady();
        });
        hlsInstance.on(Hls.Events.ERROR, function (_ev: any, data: any) {
          if (data.fatal) {
            console.error('[Player] HLS fatal error: type=' + data.type + ' details=' + data.details);
            showPlaybackError(
              { code: MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED, message: 'HLS: ' + data.details } as any,
              url
            );
          }
        });
        if (Hls.Events.SUBTITLE_TRACKS_UPDATED) {
          hlsInstance.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, function () {
            hlsSubTracks = hlsInstance.subtitleTracks || [];
          });
        }
        return;
      }
    } catch (e) { /* fallback */ }
  }

  videoEl.src = url;
  var onMeta = function () {
    if (videoEl) videoEl.removeEventListener('loadedmetadata', onMeta);
    onSourceReady();
  };
  videoEl.addEventListener('loadedmetadata', onMeta);
}



function onSourceReady(): void {
  if (!videoEl) return;
  if (resumeTime > 0) {
    var pos = resumeTime;
    resumeTime = 0;
    var v = videoEl;
    var done = false;
    var doSeek = function () {
      if (done) return;
      done = true;
      v.removeEventListener('playing', doSeek);
      v.currentTime = pos;
    };
    if (resumePaused) {
      resumePaused = false;
      v.currentTime = pos;
    } else {
      v.addEventListener('playing', doSeek);
      v.play();
    }
  } else {
    if (resumePaused) { resumePaused = false; }
    else { videoEl.play(); }
  }
  playbackStarted = true;
  qualitySwitching = false;
  startMarkTimer();
  showBar();
  updateInfoBadge();
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

function showPlaybackError(error: MediaError | null, url: string): void {
  var msg = getVideoErrorMessage(error);
  var code = error ? error.code : 0;
  var detail = error && (error as any).message ? (error as any).message : '';
  console.error('[Player] Playback error: code=' + code + ' msg=' + msg + (detail ? ' detail=' + detail : '') + ' url=' + url);
  destroyPlayer();
  $root.html(
    '<div class="player">' +
      '<div class="player__title" style="padding:60px;">' +
        '<div>' + msg + '</div>' +
        '<div style="font-size:0.7em;margin-top:20px;opacity:0.6;">Код ошибки: ' + code + '</div>' +
      '</div>' +
    '</div>'
  );
  keyHandler = function (e: JQuery.Event) {
    var kc = getKeyCode(e);
    if (kc === TvKey.Return || kc === TvKey.Backspace || kc === TvKey.Escape) {
      goBack();
      e.preventDefault();
    }
  };
  $(window).off('keydown').on('keydown', keyHandler);
}

function playUrl(url: string, title: string): void {
  var itemTitle = title.split(' - ')[0] || title;
  var epTitle = title.indexOf(' - ') >= 0 ? title.substring(title.indexOf(' - ') + 3) : '';
  $root.html(tplPlayer({ title: itemTitle, episode: epTitle }));
  videoEl = $root.find('video')[0] as HTMLVideoElement;

  var sourceUrl = url;
  videoEl.addEventListener('ended', function () {
    savePosition();
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

  // Tizen 2.3: video element needs a tick after innerHTML insertion
  // before it can accept a source reliably
  setTimeout(function () { playSource(url); }, 0);
}

// --- Mark time ---

function startMarkTimer(): void {
  stopMarkTimer();
  markTimer = window.setInterval(function () {
    if (!videoEl || !currentItem) return;
    var time = Math.floor(videoEl.currentTime);
    if (time <= 0) return;
    if (currentSeason !== undefined && currentEpisode !== undefined) {
      markTime(currentItem.id, currentEpisode, time, currentSeason);
    } else if (currentVideo !== undefined) {
      markTime(currentItem.id, currentVideo, time);
    }
  }, 15000);
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

function destroyPlayer(): void {
  savePosition();
  stopMarkTimer();
  stopProgressTimer();
  clearBarTimer();
  resetSeek();
  if (osdTimer) { clearTimeout(osdTimer); osdTimer = null; }
  if (hlsInstance) {
    try { hlsInstance.destroy(); } catch (e) { /* ignore */ }
    hlsInstance = null;
  }
  if (videoEl) {
    try { videoEl.pause(); } catch (e) { /* ignore */ }
    videoEl.removeAttribute('src');
    try { videoEl.load(); } catch (e) { /* ignore */ }
    videoEl = null;
  }
  barValueEl = null;
  barDurationEl = null;
  barSeekEl = null;
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

  if (panelOpen) { handlePanelKey(e); return; }

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
      showBar(); break;
    case TvKey.Down:
      openPanel(); break;

    case TvKey.Green:
      changeSubSize(1); break;
    case TvKey.Red:
      changeSubSize(-1); break;
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
    panelOpen = false;
    panelListOpen = false;
    useHls = false;
    currentFiles = [];
    currentAudios = [];
    currentSubs = [];
    hlsAudioTracks = [];
    hlsSubTracks = [];
    selectedQuality = 0;
    selectedAudio = 0;
    selectedSub = -1;

    $root.html('<div class="spinner"><div class="spinner__circle"></div></div>');
    var id = params.id!;

    getItem(id).then(
      function (res: any) {
        var data = Array.isArray(res) ? res[0] : res;
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
        currentAudios = media.audios;
        var itemTitle = currentItem.title.split(' / ')[0];

        loadMediaLinks(media.mid, function (files, subs) {
          currentFiles = files.slice().sort(function (a, b) { return b.w - a.w; });
          currentSubs = subs.filter(function (s) { return s.url && !s.embed; });
          selectedQuality = pickDefaultQualityIndex(currentFiles);

          if (currentFiles.length === 0) {
            $root.html('<div class="player"><div class="player__title" style="padding:60px;">Видео не найдено</div></div>');
            return;
          }

          var url = getUrlFromFile(currentFiles[selectedQuality]);
          if (url) {
            playUrl(url, itemTitle + ' - ' + currentTitle);
          } else {
            $root.html('<div class="player"><div class="player__title" style="padding:60px;">Не удалось найти видео</div></div>');
          }
        });
      },
      function () {
        $root.html('<div class="player"><div class="player__title" style="padding:60px;">Ошибка загрузки</div></div>');
      }
    );

    keyHandler = handleKey;
    $(window).on('keydown', keyHandler);
  },

  unmount: function () {
    destroyPlayer();
    if (keyHandler) { $(window).off('keydown', keyHandler); keyHandler = null; }
    $root.empty();
    panelOpen = false;
    panelListOpen = false;
  }
};
