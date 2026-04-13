import $ from 'jquery';
import { AudioTrack, Subtitle, VideoFile } from '../../types/api';
import { TvKey } from '../../utils/platform';

const PANEL_SECTIONS = ['audio', 'subs', 'quality'];

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
  audioEnabled: boolean;
  subsEnabled: boolean;
  qualityEnabled: boolean;
}

export const buildAudioLabel = (a: AudioTrack): string => {
  let label = a.lang;
  if (a.type && a.type.title) label += ' - ' + a.type.title;
  if (a.author && a.author.title) label += ' (' + a.author.title + ')';
  label += ' [' + a.codec + ' ' + a.channels + 'ch]';
  return label;
};

export const getAudioItems = (
  audios: AudioTrack[],
  selectedAudio: number,
  videoEl: HTMLVideoElement | null
): Array<{ label: string; selected: boolean }> => {
  const items: Array<{ label: string; selected: boolean }> = [];
  if (audios.length > 0) {
    for (let j = 0; j < audios.length; j++) {
      items.push({ label: buildAudioLabel(audios[j]), selected: j === selectedAudio });
    }
    return items;
  }
  if (videoEl) {
    const native = (videoEl as any).audioTracks;
    if (native && native.length > 0) {
      for (let k = 0; k < native.length; k++) {
        items.push({ label: native[k].label || native[k].language || ('Дорожка ' + (k + 1)), selected: native[k].enabled });
      }
      return items;
    }
  }
  items.push({ label: 'Нет данных', selected: false });
  return items;
};

export const getSubItems = (subs: Subtitle[], selectedSub: number): Array<{ label: string; selected: boolean }> => {
  const items: Array<{ label: string; selected: boolean }> = [];
  if (subs.length > 0) {
    items.push({ label: 'Выкл', selected: selectedSub === -1 });
    for (let j = 0; j < subs.length; j++) {
      items.push({ label: subs[j].lang.toUpperCase(), selected: j === selectedSub });
    }
    return items;
  }
  items.push({ label: 'Нет субтитров', selected: false });
  return items;
};

export const getQualityItems = (files: VideoFile[], selectedQuality: number): Array<{ label: string; selected: boolean }> => {
  const items: Array<{ label: string; selected: boolean }> = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    items.push({ label: f.quality + ' (' + f.w + 'x' + f.h + ')', selected: i === selectedQuality });
  }
  return items;
};

export const getPanelItems = (data: PanelData, section: number): Array<{ label: string; selected: boolean }> => {
  if (section === 0) return data.audioItems;
  if (section === 1) return data.subItems;
  return data.qualityItems;
};

const getSelectedLabel = (data: PanelData, section: number): string => {
  const items = getPanelItems(data, section);
  for (let i = 0; i < items.length; i++) {
    if (items[i].selected) return items[i].label;
  }
  return '...';
};

const isSectionEnabled = (data: PanelData, section: number): boolean => {
  if (section === 0) return data.audioEnabled;
  if (section === 1) return data.subsEnabled;
  return data.qualityEnabled;
};

export const updatePanelButtons = ($root: JQuery, state: PanelState, data: PanelData): void => {
  const labels = ['Аудио: ', 'Сабы: ', 'Качество: '];
  for (let i = 0; i < PANEL_SECTIONS.length; i++) {
    const $btn = $root.find('.ppanel__btn').eq(i);
    const enabled = isSectionEnabled(data, i);
    $btn.find('.ppanel__btn-label').html(labels[i] + (enabled ? getSelectedLabel(data, i) : '—'));
    $btn.toggleClass('disabled', !enabled);
    if (i === state.btnIndex && !state.listOpen) {
      $btn.addClass('focused');
    } else {
      $btn.removeClass('focused');
    }
  }
};

export const renderPanelList = ($root: JQuery, state: PanelState, data: PanelData): void => {
  const items = getPanelItems(data, state.listSection);
  let html = '';
  for (let i = 0; i < items.length; i++) {
    html += '<div class="ppanel__list-item' +
      (items[i].selected ? ' selected' : '') +
      (i === state.listIndex ? ' focused' : '') +
      '">' + items[i].label + '</div>';
  }
  const $list = $root.find('.ppanel__list');
  $list.html(html);
  scrollToFocused($list);
};

const scrollToFocused = ($list: JQuery): void => {
  const el = $list.find('.ppanel__list-item.focused')[0];
  if (!el) return;
  const container = $list[0];
  if (!container) return;
  const top = el.offsetTop;
  const bot = top + el.offsetHeight;
  if (top < container.scrollTop) {
    container.scrollTop = top;
  } else if (bot > container.scrollTop + container.clientHeight) {
    container.scrollTop = bot - container.clientHeight;
  }
};

export interface PanelCallbacks {
  onShowInfo: () => void;
  onAfterClose: () => void;
  onApplyAudio: (idx: number) => void;
  onApplySub: (menuIdx: number) => void;
  onApplyQuality: (idx: number) => void;
  onSavePrefs: () => void;
  getData: () => PanelData;
}

const PANEL_IDLE_MS = 4000;
let panelIdleTimer: number | null = null;

const resetPanelIdle = ($root: JQuery, state: PanelState, cbs: PanelCallbacks): void => {
  clearPanelIdle();
  panelIdleTimer = window.setTimeout(() => {
    panelIdleTimer = null;
    forceClosePanel($root, state, cbs);
  }, PANEL_IDLE_MS);
};

export const clearPanelIdle = (): void => {
  if (panelIdleTimer !== null) { clearTimeout(panelIdleTimer); panelIdleTimer = null; }
};

const forceClosePanel = ($root: JQuery, state: PanelState, cbs: PanelCallbacks): void => {
  if (!state.open) return;
  state.listOpen = false;
  state.open = false;
  $root.find('.ppanel__list').removeClass('active').addClass('hidden');
  $root.find('.ppanel__buttons').removeClass('active');
  $root.find('.player__panel').addClass('hidden');
  cbs.onAfterClose();
};

export const openPanel = ($root: JQuery, state: PanelState, cbs: PanelCallbacks): void => {
  if (state.open) return;
  state.open = true;
  state.listOpen = false;
  const data = cbs.getData();
  state.btnIndex = 0;
  while (state.btnIndex < PANEL_SECTIONS.length - 1 && !isSectionEnabled(data, state.btnIndex)) state.btnIndex++;
  cbs.onShowInfo();
  $root.find('.player__panel').removeClass('hidden');
  updatePanelButtons($root, state, cbs.getData());
  setTimeout(() => {
    $root.find('.ppanel__buttons').addClass('active');
  }, 20);
  resetPanelIdle($root, state, cbs);
};

export const closePanel = ($root: JQuery, state: PanelState, cbs: PanelCallbacks): void => {
  if (!state.open) return;
  clearPanelIdle();
  if (state.listOpen) {
    closePanelList($root, state, cbs);
    return;
  }
  state.open = false;
  $root.find('.ppanel__buttons').removeClass('active');
  setTimeout(() => {
    $root.find('.player__panel').addClass('hidden');
    cbs.onAfterClose();
  }, 200);
};

export const openPanelList = ($root: JQuery, state: PanelState, cbs: PanelCallbacks): void => {
  state.listOpen = true;
  state.listSection = state.btnIndex;
  const data = cbs.getData();
  const items = getPanelItems(data, state.listSection);
  state.listIndex = 0;
  for (let i = 0; i < items.length; i++) {
    if (items[i].selected) { state.listIndex = i; break; }
  }
  renderPanelList($root, state, data);
  updatePanelButtons($root, state, data);
  $root.find('.ppanel__buttons').removeClass('active');
  $root.find('.ppanel__list').removeClass('hidden');
  setTimeout(() => {
    $root.find('.ppanel__list').addClass('active');
  }, 20);
};

export const closePanelList = ($root: JQuery, state: PanelState, cbs: PanelCallbacks): void => {
  state.listOpen = false;
  $root.find('.ppanel__list').removeClass('active');
  setTimeout(() => {
    $root.find('.ppanel__list').addClass('hidden');
    $root.find('.ppanel__buttons').addClass('active');
    updatePanelButtons($root, state, cbs.getData());
  }, 200);
};

const applyPanelSelection = ($root: JQuery, state: PanelState, cbs: PanelCallbacks): void => {
  if (state.listSection === 0) {
    cbs.onApplyAudio(state.listIndex);
  } else if (state.listSection === 1) {
    cbs.onApplySub(state.listIndex);
  } else {
    cbs.onApplyQuality(state.listIndex);
  }
  cbs.onSavePrefs();
  const data = cbs.getData();
  updatePanelButtons($root, state, data);
  renderPanelList($root, state, data);
};

export const handlePanelKey = (
  e: JQuery.Event,
  kc: number,
  $root: JQuery,
  state: PanelState,
  cbs: PanelCallbacks
): void => {
  resetPanelIdle($root, state, cbs);

  if (state.listOpen) {
    const data = cbs.getData();
    const items = getPanelItems(data, state.listSection);
    switch (kc) {
      case TvKey.Up:
        if (state.listIndex > 0) { state.listIndex--; renderPanelList($root, state, data); }
        e.preventDefault(); break;
      case TvKey.Down:
        if (state.listIndex < items.length - 1) { state.listIndex++; renderPanelList($root, state, data); }
        e.preventDefault(); break;
      case TvKey.Enter:
        if (items[state.listIndex] && !items[state.listIndex].selected) {
          applyPanelSelection($root, state, cbs);
        }
        closePanelList($root, state, cbs);
        e.preventDefault(); break;
      case TvKey.Return: case TvKey.Backspace: case TvKey.Escape:
        closePanelList($root, state, cbs); e.preventDefault(); break;
    }
    return;
  }

  switch (kc) {
    case TvKey.Left: {
      const data = cbs.getData();
      let idx = state.btnIndex - 1;
      while (idx >= 0 && !isSectionEnabled(data, idx)) idx--;
      if (idx >= 0) { state.btnIndex = idx; updatePanelButtons($root, state, data); }
      e.preventDefault(); break;
    }
    case TvKey.Right: {
      const data = cbs.getData();
      let idx = state.btnIndex + 1;
      while (idx < PANEL_SECTIONS.length && !isSectionEnabled(data, idx)) idx++;
      if (idx < PANEL_SECTIONS.length) { state.btnIndex = idx; updatePanelButtons($root, state, data); }
      e.preventDefault(); break;
    }
    case TvKey.Enter:
      if (isSectionEnabled(cbs.getData(), state.btnIndex)) { openPanelList($root, state, cbs); }
      e.preventDefault(); break;
    case TvKey.Return: case TvKey.Backspace: case TvKey.Escape: case TvKey.Down:
      closePanel($root, state, cbs); e.preventDefault(); break;
  }
};
