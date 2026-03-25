import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { getItem } from '../api/items';
import { markTime } from '../api/watching';
import { apiGet } from '../api/client';
import { Item, VideoFile, AudioTrack, Subtitle } from '../types/api';
import { goBack } from '../router';
import { TvKey } from '../utils/platform';

var $root = $('#page-player');
var keyHandler: ((e: JQuery.Event) => void) | null = null;
var markTimer: number | null = null;
var overlayTimer: number | null = null;
var videoEl: HTMLVideoElement | null = null;
var hlsInstance: any = null;

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
var hlsAudioTracks: any[] = [];
var hlsSubTracks: any[] = [];
var useHls = false;

var menuOpen = false;
var menuSection = 0;
var menuItemIndex = 0;
var lastEnterTime = 0;

var MENU_SECTIONS = ['Качество', 'Аудио', 'Субтитры'];

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
  return urls.hls4 || urls.hls || urls.http || '';
}

function findEpisodeData(item: Item, seasonNum: number, epNum: number): { files: VideoFile[]; audios: AudioTrack[]; subs: Subtitle[]; title: string } | null {
  if (!item.seasons) return null;
  for (var i = 0; i < item.seasons.length; i++) {
    var s = item.seasons[i];
    if (s.number === seasonNum) {
      for (var j = 0; j < s.episodes.length; j++) {
        var ep = s.episodes[j];
        if (ep.number === epNum) {
          return { files: ep.files || [], audios: ep.audios || [], subs: ep.subtitles || [], title: ep.title || 'S' + seasonNum + 'E' + epNum };
        }
      }
    }
  }
  return null;
}

function findVideoData(item: Item, videoNum: number): { files: VideoFile[]; audios: AudioTrack[]; subs: Subtitle[]; title: string } | null {
  if (!item.videos) return null;
  var idx = videoNum - 1;
  if (idx >= 0 && idx < item.videos.length) {
    var v = item.videos[idx];
    return { files: v.files || [], audios: v.audios || [], subs: v.subtitles || [], title: v.title || 'Видео ' + videoNum };
  }
  return null;
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
    '<div class="player__overlay hidden">' +
      '<div class="player__title">{{=it.title}}</div>' +
      '<div class="player__progress"><div class="player__progress-bar"></div></div>' +
      '<div class="player__time">00:00 / 00:00</div>' +
    '</div>' +
    '<div class="player__menu hidden"></div>' +
  '</div>'
);

var tplMenu = doT.template(
  '<div class="pmenu">' +
    '<div class="pmenu__tabs">' +
      '{{~it.sections :sec:si}}' +
        '<div class="pmenu__tab{{?si===it.active}} active{{?}}">{{=sec}}</div>' +
      '{{~}}' +
    '</div>' +
    '<div class="pmenu__items">{{=it.items}}</div>' +
  '</div>'
);

var tplMenuItem = doT.template(
  '<div class="pmenu__item{{?it.selected}} selected{{?}}{{?it.focused}} focused{{?}}">{{=it.label}}</div>'
);

// --- Overlay ---

function showOverlay(): void {
  $root.find('.player__overlay').removeClass('hidden');
  clearOverlayTimer();
  overlayTimer = window.setTimeout(hideOverlay, 4000);
}

function hideOverlay(): void {
  $root.find('.player__overlay').addClass('hidden');
}

function clearOverlayTimer(): void {
  if (overlayTimer !== null) { clearTimeout(overlayTimer); overlayTimer = null; }
}

function updateProgress(): void {
  if (!videoEl) return;
  var cur = videoEl.currentTime;
  var dur = videoEl.duration || 1;
  $root.find('.player__progress-bar').css('width', (cur / dur) * 100 + '%');
  $root.find('.player__time').text(formatTime(cur) + ' / ' + formatTime(dur));
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

// --- Menu ---

function buildAudioLabel(a: AudioTrack): string {
  var label = a.lang;
  if (a.type && a.type.title) label += ' - ' + a.type.title;
  if (a.author && a.author.title) label += ' (' + a.author.title + ')';
  label += ' [' + a.codec + ' ' + a.channels + 'ch]';
  return label;
}

function getAudioItems(): Array<{ label: string; selected: boolean }> {
  var items: Array<{ label: string; selected: boolean }> = [];

  // Prefer API audios -- they have richer metadata
  if (currentAudios.length > 0) {
    for (var j = 0; j < currentAudios.length; j++) {
      items.push({ label: buildAudioLabel(currentAudios[j]), selected: j === selectedAudio });
    }
    return items;
  }

  // Fallback: HLS audio tracks from manifest (deduplicated)
  if (useHls && hlsAudioTracks.length > 1) {
    var seen: Record<string, boolean> = {};
    for (var i = 0; i < hlsAudioTracks.length; i++) {
      var at = hlsAudioTracks[i];
      var lbl = at.name || at.lang || ('Дорожка ' + (i + 1));
      if (seen[lbl]) {
        lbl += ' #' + (i + 1);
      }
      seen[lbl] = true;
      items.push({ label: lbl, selected: i === selectedAudio });
    }
    return items;
  }

  // Fallback: native <video> audio tracks
  if (videoEl) {
    var native = (videoEl as any).audioTracks;
    if (native && native.length > 0) {
      for (var k = 0; k < native.length; k++) {
        items.push({ label: native[k].label || native[k].language || ('Дорожка ' + (k + 1)), selected: native[k].enabled });
      }
      return items;
    }
  }

  items.push({ label: 'Нет данных', selected: false });
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

  // Use native VIDEO.textTracks (populated by HLS.js from manifest)
  var tracks = getVideoTextTracks();
  if (tracks && tracks.length > 0) {
    items.push({ label: 'Выкл', selected: selectedSub === -1 });
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      var label = (t.label || t.language || 'Субтитры ' + (i + 1));
      if (label.length <= 3) label = label.toUpperCase();
      items.push({ label: label, selected: i === selectedSub });
    }
    return items;
  }

  // Fallback: external API subtitles (non-HLS)
  if (currentSubs.length > 0) {
    items.push({ label: 'Выкл', selected: selectedSub === -1 });
    for (var j = 0; j < currentSubs.length; j++) {
      items.push({ label: currentSubs[j].lang.toUpperCase(), selected: j === selectedSub });
    }
    return items;
  }

  items.push({ label: 'Нет субтитров', selected: false });
  return items;
}

function getMenuItems(): Array<{ label: string; selected: boolean }> {
  if (menuSection === 0) {
    var items: Array<{ label: string; selected: boolean }> = [];
    for (var i = 0; i < currentFiles.length; i++) {
      var f = currentFiles[i];
      items.push({ label: f.quality + ' (' + f.w + 'x' + f.h + ')', selected: i === selectedQuality });
    }
    return items;
  } else if (menuSection === 1) {
    return getAudioItems();
  } else {
    return getSubItems();
  }
}

function renderMenu(): void {
  var items = getMenuItems();
  var html = '';
  for (var i = 0; i < items.length; i++) {
    html += tplMenuItem({ label: items[i].label, selected: items[i].selected, focused: i === menuItemIndex });
  }
  $root.find('.player__menu').html(tplMenu({ sections: MENU_SECTIONS, active: menuSection, items: html })).removeClass('hidden');
}

function openMenu(withPause: boolean): void {
  if (menuOpen) return;
  menuOpen = true;
  if (withPause && videoEl && !videoEl.paused) { videoEl.pause(); }
  clearOverlayTimer();
  hideOverlay();
  menuSection = 0;
  menuItemIndex = findSelectedIndex();
  renderMenu();
}

function closeMenu(): void {
  if (!menuOpen) return;
  menuOpen = false;
  $root.find('.player__menu').addClass('hidden');
  if (videoEl && videoEl.paused) { videoEl.play(); }
  showOverlay();
}

function findSelectedIndex(): number {
  var items = getMenuItems();
  for (var i = 0; i < items.length; i++) {
    if (items[i].selected) return i;
  }
  return 0;
}

function switchMenuSection(dir: number): void {
  menuSection = Math.max(0, Math.min(MENU_SECTIONS.length - 1, menuSection + dir));
  menuItemIndex = findSelectedIndex();
  renderMenu();
}

function applyMenuSelection(): void {
  if (menuSection === 0) {
    if (menuItemIndex !== selectedQuality) {
      selectedQuality = menuItemIndex;
      switchQuality();
    }
  } else if (menuSection === 1) {
    applyAudioSwitch(menuItemIndex);
  } else if (menuSection === 2) {
    applySubSwitch(menuItemIndex);
  }
  renderMenu();
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
  // menuIdx 0 = off, 1+ = sub index
  var subIdx = menuIdx - 1;
  selectedSub = subIdx;

  // Use native VIDEO.textTracks (from HLS manifest)
  var tracks = getVideoTextTracks();
  if (tracks && tracks.length > 0) {
    for (var i = 0; i < tracks.length; i++) {
      tracks[i].mode = (i === subIdx) ? 'showing' : 'disabled';
    }
    return;
  }

  // External API subtitles -- load as <track> element
  if (currentSubs.length > 0) {
    loadSubtitleTrack(subIdx);
    return;
  }
}

function switchQuality(): void {
  if (!videoEl || currentFiles.length === 0) return;
  var pos = videoEl.currentTime;
  var wasPlaying = !videoEl.paused;
  var url = getUrlFromFile(currentFiles[selectedQuality]);
  if (!url) return;

  if (hlsInstance) { hlsInstance.destroy(); hlsInstance = null; }

  resumeTime = pos;
  playSource(url);
  if (!wasPlaying && videoEl) { videoEl.pause(); }
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
        hlsInstance = new Hls({ enableWorker: false, renderTextTracksNatively: true });
        hlsInstance.loadSource(url);
        hlsInstance.attachMedia(videoEl);
        hlsInstance.on(Hls.Events.MANIFEST_PARSED, function (_ev: any, _data: any) {
          hlsAudioTracks = hlsInstance.audioTracks || [];
          hlsSubTracks = hlsInstance.subtitleTracks || [];
          onSourceReady();
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
  videoEl.addEventListener('loadedmetadata', function () { onSourceReady(); }, { once: true } as any);
}

function onSourceReady(): void {
  if (!videoEl) return;
  if (resumeTime > 0) { videoEl.currentTime = resumeTime; resumeTime = 0; }
  videoEl.play();
  startMarkTimer();
  showOverlay();
  videoEl.removeEventListener('timeupdate', updateProgress);
  videoEl.addEventListener('timeupdate', updateProgress);
}

function showSpinner(): void {
  $root.find('.player__spinner').show();
}

function hideSpinner(): void {
  $root.find('.player__spinner').hide();
}

function playUrl(url: string, title: string): void {
  $root.html(tplPlayer({ title: title }));
  videoEl = $root.find('video')[0] as HTMLVideoElement;

  videoEl.addEventListener('ended', function () { savePosition(); goBack(); });
  videoEl.addEventListener('waiting', showSpinner);
  videoEl.addEventListener('seeking', showSpinner);
  videoEl.addEventListener('canplay', hideSpinner);
  videoEl.addEventListener('playing', hideSpinner);
  videoEl.addEventListener('seeked', hideSpinner);

  playSource(url);
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
  clearOverlayTimer();
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
}

// --- Keys ---

function handleKey(e: JQuery.Event): void {
  if (!videoEl) return;

  if (menuOpen) { handleMenuKey(e); return; }

  switch (e.keyCode) {
    case TvKey.Return: case TvKey.Backspace: case TvKey.Escape: case TvKey.Stop:
      destroyPlayer(); goBack(); e.preventDefault(); break;
    case TvKey.Enter:
      if (videoEl.paused) { videoEl.play(); showOverlay(); }
      else { videoEl.pause(); openMenu(false); }
      e.preventDefault(); break;
    case TvKey.Play:
      if (videoEl.paused) { videoEl.play(); showOverlay(); }
      e.preventDefault(); break;
    case TvKey.Pause:
      videoEl.pause(); showOverlay(); e.preventDefault(); break;
    case TvKey.Up:
      openMenu(true); e.preventDefault(); break;
    case TvKey.Right: case TvKey.Ff:
      videoEl.currentTime = Math.min(videoEl.duration, videoEl.currentTime + 10);
      showOverlay(); e.preventDefault(); break;
    case TvKey.Left: case TvKey.Rw:
      videoEl.currentTime = Math.max(0, videoEl.currentTime - 10);
      showOverlay(); e.preventDefault(); break;
    case TvKey.Down:
      videoEl.currentTime = Math.max(0, videoEl.currentTime - 60);
      showOverlay(); e.preventDefault(); break;
  }
}

function handleMenuKey(e: JQuery.Event): void {
  var items = getMenuItems();

  switch (e.keyCode) {
    case TvKey.Up:
      if (menuItemIndex > 0) { menuItemIndex--; renderMenu(); }
      e.preventDefault(); break;
    case TvKey.Down:
      if (menuItemIndex < items.length - 1) { menuItemIndex++; renderMenu(); }
      e.preventDefault(); break;
    case TvKey.Left:
      if (menuSection > 0) { switchMenuSection(-1); }
      e.preventDefault(); break;
    case TvKey.Right:
      if (menuSection < MENU_SECTIONS.length - 1) { switchMenuSection(1); }
      e.preventDefault(); break;
    case TvKey.Enter:
      var now = Date.now();
      if (now - lastEnterTime < 500) { applyMenuSelection(); closeMenu(); }
      else { applyMenuSelection(); }
      lastEnterTime = now;
      e.preventDefault(); break;
    case TvKey.Return: case TvKey.Backspace: case TvKey.Escape:
      closeMenu(); e.preventDefault(); break;
  }
}

// --- Page ---

export var playerPage: Page = {
  mount: function (params: RouteParams) {
    currentItem = null;
    currentSeason = params.season;
    currentEpisode = params.episode;
    currentVideo = params.video;
    resumeTime = 0;
    menuOpen = false;
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

        var result: { files: VideoFile[]; audios: AudioTrack[]; subs: Subtitle[]; title: string } | null = null;

        if (currentSeason !== undefined && currentEpisode !== undefined) {
          result = findEpisodeData(currentItem, currentSeason, currentEpisode);
          resumeTime = getResumeTime(currentItem, currentSeason, currentEpisode);
        } else if (currentVideo !== undefined) {
          result = findVideoData(currentItem, currentVideo);
          resumeTime = getResumeTime(currentItem, undefined, undefined, currentVideo);
        }

        if (!result || result.files.length === 0) {
          $root.html('<div class="player"><div class="player__title" style="padding:60px;">Видео не найдено</div></div>');
          return;
        }

        currentFiles = result.files.slice().sort(function (a, b) { return b.w - a.w; });
        currentAudios = result.audios;
        currentSubs = result.subs.filter(function (s) { return s.url && !s.embed; });
        currentTitle = result.title;

        // Load subtitles from media-links API if not present
        if (currentSubs.length === 0 && currentFiles.length > 0 && currentFiles[0].file) {
          var mid = currentFiles[0].file!;
          apiGet('/v1/items/media-links', { mid: mid }).then(function (mlRes: any) {
            var mlData = Array.isArray(mlRes) ? mlRes[0] : mlRes;
            if (mlData && mlData.subtitles) {
              currentSubs = mlData.subtitles;
            }
          });
        }

        var url = getUrlFromFile(currentFiles[0]);
        if (url) {
          var itemTitle = currentItem.title.split(' / ')[0];
          playUrl(url, itemTitle + ' - ' + currentTitle);
        } else {
          $root.html('<div class="player"><div class="player__title" style="padding:60px;">Не удалось найти видео</div></div>');
        }
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
    menuOpen = false;
  }
};
