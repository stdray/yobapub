import $ from 'jquery';
import { AudioTrack, Subtitle, VideoFile } from '../../types/api';
import { TvKey } from '../../utils/platform';

var PANEL_SECTIONS = ['audio', 'subs', 'quality'];

export interface PanelState {
  open: boolean;
  btnIndex: number;
  listOpen: boolean;
  listIndex: number;
  listSection: number;
}

export interface PanelData {
  audioItems: Array<{ label: string; selected: boolean }>;
  subItems: Array<{ label: string; selected: boolean }>;
  qualityItems: Array<{ label: string; selected: boolean }>;
}

export function buildAudioLabel(a: AudioTrack): string {
  var label = a.lang;
  if (a.type && a.type.title) label += ' - ' + a.type.title;
  if (a.author && a.author.title) label += ' (' + a.author.title + ')';
  label += ' [' + a.codec + ' ' + a.channels + 'ch]';
  return label;
}

export function getAudioItems(
  audios: AudioTrack[],
  selectedAudio: number,
  useHls: boolean,
  hlsAudioTracks: any[],
  videoEl: HTMLVideoElement | null
): Array<{ label: string; selected: boolean }> {
  var items: Array<{ label: string; selected: boolean }> = [];
  if (audios.length > 0) {
    for (var j = 0; j < audios.length; j++) {
      items.push({ label: buildAudioLabel(audios[j]), selected: j === selectedAudio });
    }
    return items;
  }
  if (useHls && hlsAudioTracks.length > 1) {
    var seen: Record<string, boolean> = {};
    for (var i = 0; i < hlsAudioTracks.length; i++) {
      var at = hlsAudioTracks[i];
      var lbl = at.name || at.lang || ('Дорожка ' + (i + 1));
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
        items.push({ label: native[k].label || native[k].language || ('Дорожка ' + (k + 1)), selected: native[k].enabled });
      }
      return items;
    }
  }
  items.push({ label: 'Нет данных', selected: false });
  return items;
}

export function getSubItems(subs: Subtitle[], selectedSub: number): Array<{ label: string; selected: boolean }> {
  var items: Array<{ label: string; selected: boolean }> = [];
  if (subs.length > 0) {
    items.push({ label: 'Выкл', selected: selectedSub === -1 });
    for (var j = 0; j < subs.length; j++) {
      items.push({ label: subs[j].lang.toUpperCase(), selected: j === selectedSub });
    }
    return items;
  }
  items.push({ label: 'Нет субтитров', selected: false });
  return items;
}

export function getQualityItems(files: VideoFile[], selectedQuality: number): Array<{ label: string; selected: boolean }> {
  var items: Array<{ label: string; selected: boolean }> = [];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    items.push({ label: f.quality + ' (' + f.w + 'x' + f.h + ')', selected: i === selectedQuality });
  }
  return items;
}

export function getPanelItems(data: PanelData, section: number): Array<{ label: string; selected: boolean }> {
  if (section === 0) return data.audioItems;
  if (section === 1) return data.subItems;
  return data.qualityItems;
}

function getSelectedLabel(data: PanelData, section: number): string {
  var items = getPanelItems(data, section);
  for (var i = 0; i < items.length; i++) {
    if (items[i].selected) return items[i].label;
  }
  return '...';
}

export function updatePanelButtons($root: JQuery, state: PanelState, data: PanelData): void {
  var labels = ['Аудио: ', 'Сабы: ', 'Качество: '];
  for (var i = 0; i < PANEL_SECTIONS.length; i++) {
    var $btn = $root.find('.ppanel__btn').eq(i);
    $btn.find('.ppanel__btn-label').html(labels[i] + getSelectedLabel(data, i));
    if (i === state.btnIndex && !state.listOpen) {
      $btn.addClass('focused');
    } else {
      $btn.removeClass('focused');
    }
  }
}

export function renderPanelList($root: JQuery, state: PanelState, data: PanelData): void {
  var items = getPanelItems(data, state.listSection);
  var html = '';
  for (var i = 0; i < items.length; i++) {
    html += '<div class="ppanel__list-item' +
      (items[i].selected ? ' selected' : '') +
      (i === state.listIndex ? ' focused' : '') +
      '">' + items[i].label + '</div>';
  }
  var $list = $root.find('.ppanel__list');
  $list.html(html);
  scrollToFocused($list);
}

function scrollToFocused($list: JQuery): void {
  var el = $list.find('.ppanel__list-item.focused')[0];
  if (!el) return;
  var container = $list[0];
  if (!container) return;
  var top = el.offsetTop - container.offsetTop;
  var bot = top + el.offsetHeight;
  if (top < container.scrollTop) {
    container.scrollTop = top;
  } else if (bot > container.scrollTop + container.clientHeight) {
    container.scrollTop = bot - container.clientHeight;
  }
}

export interface PanelCallbacks {
  onShowBar: () => void;
  onHideBar: () => void;
  onClearBarTimer: () => void;
  onApplyAudio: (idx: number) => void;
  onApplySub: (menuIdx: number) => void;
  onApplyQuality: (idx: number) => void;
  onSavePrefs: () => void;
  getData: () => PanelData;
}

var PANEL_IDLE_MS = 40000;
var panelIdleTimer: number | null = null;

function resetPanelIdle($root: JQuery, state: PanelState, cbs: PanelCallbacks): void {
  clearPanelIdle();
  panelIdleTimer = window.setTimeout(function () {
    panelIdleTimer = null;
    forceClosePanel($root, state, cbs);
  }, PANEL_IDLE_MS);
}

export function clearPanelIdle(): void {
  if (panelIdleTimer !== null) { clearTimeout(panelIdleTimer); panelIdleTimer = null; }
}

function forceClosePanel($root: JQuery, state: PanelState, cbs: PanelCallbacks): void {
  if (!state.open) return;
  state.listOpen = false;
  state.open = false;
  $root.find('.ppanel__list').removeClass('active').addClass('hidden');
  $root.find('.ppanel__buttons').removeClass('active');
  $root.find('.player__panel').addClass('hidden');
  cbs.onShowBar();
}

export function openPanel($root: JQuery, state: PanelState, cbs: PanelCallbacks): void {
  if (state.open) return;
  state.open = true;
  state.btnIndex = 0;
  state.listOpen = false;
  cbs.onClearBarTimer();
  cbs.onHideBar();
  $root.find('.player__panel').removeClass('hidden');
  updatePanelButtons($root, state, cbs.getData());
  setTimeout(function () {
    $root.find('.ppanel__buttons').addClass('active');
  }, 20);
  resetPanelIdle($root, state, cbs);
}

export function closePanel($root: JQuery, state: PanelState, cbs: PanelCallbacks): void {
  if (!state.open) return;
  clearPanelIdle();
  if (state.listOpen) {
    closePanelList($root, state, cbs);
    return;
  }
  $root.find('.ppanel__buttons').removeClass('active');
  setTimeout(function () {
    state.open = false;
    $root.find('.player__panel').addClass('hidden');
    cbs.onShowBar();
  }, 200);
}

export function openPanelList($root: JQuery, state: PanelState, cbs: PanelCallbacks): void {
  state.listOpen = true;
  state.listSection = state.btnIndex;
  var data = cbs.getData();
  var items = getPanelItems(data, state.listSection);
  state.listIndex = 0;
  for (var i = 0; i < items.length; i++) {
    if (items[i].selected) { state.listIndex = i; break; }
  }
  renderPanelList($root, state, data);
  updatePanelButtons($root, state, data);
  $root.find('.ppanel__buttons').removeClass('active');
  $root.find('.ppanel__list').removeClass('hidden');
  setTimeout(function () {
    $root.find('.ppanel__list').addClass('active');
  }, 20);
}

export function closePanelList($root: JQuery, state: PanelState, cbs: PanelCallbacks): void {
  $root.find('.ppanel__list').removeClass('active');
  setTimeout(function () {
    state.listOpen = false;
    $root.find('.ppanel__list').addClass('hidden');
    $root.find('.ppanel__buttons').addClass('active');
    updatePanelButtons($root, state, cbs.getData());
  }, 200);
}

function applyPanelSelection($root: JQuery, state: PanelState, cbs: PanelCallbacks): void {
  if (state.listSection === 0) {
    cbs.onApplyAudio(state.listIndex);
  } else if (state.listSection === 1) {
    cbs.onApplySub(state.listIndex);
  } else {
    cbs.onApplyQuality(state.listIndex);
  }
  cbs.onSavePrefs();
  var data = cbs.getData();
  updatePanelButtons($root, state, data);
  renderPanelList($root, state, data);
}

export function handlePanelKey(
  e: JQuery.Event,
  kc: number,
  $root: JQuery,
  state: PanelState,
  cbs: PanelCallbacks
): void {
  resetPanelIdle($root, state, cbs);

  if (state.listOpen) {
    var data = cbs.getData();
    var items = getPanelItems(data, state.listSection);
    switch (kc) {
      case TvKey.Up:
        if (state.listIndex > 0) { state.listIndex--; renderPanelList($root, state, data); }
        e.preventDefault(); break;
      case TvKey.Down:
        if (state.listIndex < items.length - 1) { state.listIndex++; renderPanelList($root, state, data); }
        e.preventDefault(); break;
      case TvKey.Enter:
        if (items[state.listIndex] && items[state.listIndex].selected) { closePanelList($root, state, cbs); }
        else { applyPanelSelection($root, state, cbs); }
        e.preventDefault(); break;
      case TvKey.Return: case TvKey.Backspace: case TvKey.Escape:
        closePanelList($root, state, cbs); e.preventDefault(); break;
    }
    return;
  }

  switch (kc) {
    case TvKey.Left:
      if (state.btnIndex > 0) { state.btnIndex--; updatePanelButtons($root, state, cbs.getData()); }
      e.preventDefault(); break;
    case TvKey.Right:
      if (state.btnIndex < PANEL_SECTIONS.length - 1) { state.btnIndex++; updatePanelButtons($root, state, cbs.getData()); }
      e.preventDefault(); break;
    case TvKey.Enter:
      openPanelList($root, state, cbs); e.preventDefault(); break;
    case TvKey.Return: case TvKey.Backspace: case TvKey.Escape: case TvKey.Down:
      closePanel($root, state, cbs); e.preventDefault(); break;
  }
}
