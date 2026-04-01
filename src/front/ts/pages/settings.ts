import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { getDeviceSettings, saveDeviceSettings, checkVip } from '../api/device';
import { TvKey, platform } from '../utils/platform';
import { storage, Storage } from '../utils/storage';
import { PageKeys, PageUtils } from '../utils/page';
import { sidebar } from '../sidebar';

const $root = $('#page-settings');
const keys = new PageKeys();

interface SettingOption {
  id: number;
  label: string;
  description: string;
  selected: number;
}

interface SettingItem {
  key: string;
  label: string;
  type: string; // 'checkbox' | 'list'
  value: any;
  options?: SettingOption[];
}

let allSettings: SettingItem[] = [];
let focusedIndex = 0;
let focusedOptionIndex = 0;
let optionsOpen = false;
let vipUser = false;

const DISPLAY_KEYS: Record<string, boolean> = {
  serverLocation: true,
  streamingType: true,
  supportSsl: true,
  supportHevc: true,
  supportHdr: true,
  support4k: true,
  mixedPlaylist: true
};

const LABELS: Record<string, string> = {
  serverLocation: 'Сервер',
  streamingType: 'Тип стриминга',
  supportSsl: 'SSL',
  supportHevc: 'HEVC',
  supportHdr: 'HDR',
  support4k: '4K',
  mixedPlaylist: 'Смешанный плейлист'
};

const tplPageCompiled = doT.template(`
  <div class="settings-page">
    <div class="settings-page__title">Настройки</div>
    <div class="settings-page__list">{{=it.items}}</div>
    <div class="settings-page__version">{{=it.version}}</div>
  </div>
`);

const tplPage = (data: { readonly items: string; readonly version: string }): string =>
  tplPageCompiled(data);

const tplSettingItemCompiled = doT.template(`
  <div class="sitem{{?it.focused}} focused{{?}}{{?it.stepper}} sitem--stepper{{?}}" data-idx="{{=it.idx}}">
    <span class="sitem__label">{{=it.label}}</span>
    {{?it.stepper}}
      <span class="sitem__stepper">
        <span class="sitem__step-btn sitem__step-btn--minus">&minus;</span>
        <span class="sitem__step-val">{{=it.value}}</span>
        <span class="sitem__step-btn sitem__step-btn--plus">+</span>
      </span>
    {{??}}
      <span class="sitem__value">{{=it.value}}</span>
    {{?}}
  </div>
`);

const tplSettingItem = (data: { readonly idx: number; readonly label: string; readonly value: string; readonly focused: boolean; readonly stepper: boolean }): string =>
  tplSettingItemCompiled(data);

const tplOptionsCompiled = doT.template(`
  <div class="soptions">
    <div class="soptions__title">{{=it.title}}</div>
    {{~it.options :opt:i}}
      <div class="soptions__item{{?opt.selected}} selected{{?}}{{?i===it.focused}} focused{{?}}" data-oi="{{=i}}">{{=opt.label}}</div>
    {{~}}
  </div>
`);

const tplOptions = (data: { readonly title: string; readonly options: Array<{ readonly label: string; readonly selected: boolean }>; readonly focused: number }): string =>
  tplOptionsCompiled(data);

const parseSettings = (raw: Record<string, any>): SettingItem[] => {
  const items: SettingItem[] = [];
  for (const key in raw) {
    if (!raw.hasOwnProperty(key)) continue;
    if (!DISPLAY_KEYS[key]) continue;

    const setting = raw[key];
    const label = LABELS[key] || (setting.label || key);

    if (setting.type === 'list') {
      const opts: SettingOption[] = [];
      if (Array.isArray(setting.value)) {
        for (let i = 0; i < setting.value.length; i++) {
          const optLabel = String(setting.value[i].label || setting.value[i].id || '').toLowerCase();
          if (key === 'streamingType' && optLabel === 'http') continue;
          if (key === 'streamingType' && platform.isLegacyTizen() && optLabel === 'hls4') continue;
          opts.push({
            id: setting.value[i].id,
            label: setting.value[i].label,
            description: setting.value[i].description || '',
            selected: setting.value[i].selected
          });
        }
      }
      items.push({ key: key, label: label, type: 'list', value: null, options: opts });
    } else {
      items.push({ key: key, label: label, type: 'checkbox', value: setting.value });
    }
  }
  return items;
};

const buildQualitySetting = (): SettingItem => {
  let savedId = storage.getDefaultQuality();
  if (savedId === -1) {
    savedId = platform.isLegacyTizen() ? 3 : 0;
    storage.setDefaultQuality(savedId);
  }
  const opts: SettingOption[] = [];
  for (let i = 0; i < Storage.QUALITY_OPTIONS.length; i++) {
    const q = Storage.QUALITY_OPTIONS[i];
    opts.push({ id: q.id, label: q.label, description: '', selected: q.id === savedId ? 1 : 0 });
  }
  return { key: '_defaultQuality', label: 'Качество по умолчанию', type: 'list', value: null, options: opts };
};

const buildSubSizeSetting = (): SettingItem => {
  return { key: '_subSize', label: 'Размер субтитров', type: 'stepper', value: storage.getSubSize() };
};

const buildStartPageSetting = (): SettingItem => {
  const savedId = storage.getStartPage();
  const opts: SettingOption[] = [];
  for (let i = 0; i < Storage.START_PAGE_OPTIONS.length; i++) {
    const o = Storage.START_PAGE_OPTIONS[i];
    opts.push({ id: i, label: o.label, description: '', selected: o.id === savedId ? 1 : 0 });
  }
  return { key: '_startPage', label: 'Стартовая страница', type: 'list', value: null, options: opts };
};

const buildProxyModeSetting = (isVip: boolean): SettingItem => {
  const mode = storage.getProxyMode();
  const available = storage.getAvailableProxyModes(isVip);
  const opts: SettingOption[] = available.map((o, i) => ({
    id: i,
    label: o.label,
    description: '',
    selected: o.id === mode ? 1 : 0,
  }));
  return { key: '_proxyMode', label: 'Проксировать', type: 'list', value: null, options: opts };
};

const getDisplayValue = (item: SettingItem): string => {
  if (item.type === 'stepper') {
    const v = item.value as number;
    let lbl = v + 'px';
    if (v === Storage.DEFAULT_SUB_SIZE) lbl += ' (стандарт)';
    return lbl;
  }
  if (item.type === 'list' && item.options) {
    for (let i = 0; i < item.options.length; i++) {
      if (item.options[i].selected) return item.options[i].label;
    }
    return '—';
  }
  return item.value ? 'Вкл' : 'Выкл';
};

const render = (): void => {
  let html = '';
  for (let i = 0; i < allSettings.length; i++) {
    html += tplSettingItem({
      idx: i,
      label: allSettings[i].label,
      value: getDisplayValue(allSettings[i]),
      focused: !optionsOpen && i === focusedIndex,
      stepper: allSettings[i].type === 'stepper'
    });
  }
  $root.html(tplPage({ items: html, version: __APP_VERSION__ }));
};

const renderOptions = (): void => {
  const item = allSettings[focusedIndex];
  if (!item) return;

  if (item.type === 'list' && item.options) {
    const opts = item.options.map((o) => ({
      label: o.label, selected: o.selected === 1
    }));
    $root.find('.settings-page__list').append(
      '<div class="soptions-overlay">' +
      tplOptions({ title: item.label, options: opts, focused: focusedOptionIndex }) +
      '</div>'
    );
  } else {
    const checkOpts = [
      { label: 'Выкл', selected: !item.value },
      { label: 'Вкл', selected: !!item.value }
    ];
    $root.find('.settings-page__list').append(
      '<div class="soptions-overlay">' +
      tplOptions({ title: item.label, options: checkOpts, focused: focusedOptionIndex }) +
      '</div>'
    );
  }
};

const closeOptions = (): void => {
  optionsOpen = false;
  $root.find('.soptions-overlay').remove();
  render();
};

const applyOption = (): void => {
  const item = allSettings[focusedIndex];
  if (!item) return;

  if (item.key === '_defaultQuality') {
    if (item.options) {
      for (let j = 0; j < item.options.length; j++) {
        item.options[j].selected = (j === focusedOptionIndex) ? 1 : 0;
      }
      storage.setDefaultQuality(item.options[focusedOptionIndex].id);
    }
    closeOptions();
    return;
  }

  if (item.key === '_startPage') {
    if (item.options) {
      for (let k = 0; k < item.options.length; k++) {
        item.options[k].selected = (k === focusedOptionIndex) ? 1 : 0;
      }
      storage.setStartPage(Storage.START_PAGE_OPTIONS[focusedOptionIndex].id);
    }
    closeOptions();
    return;
  }

  if (item.key === '_proxyMode') {
    if (item.options) {
      const available = storage.getAvailableProxyModes(vipUser);
      for (let j = 0; j < item.options.length; j++) {
        item.options[j].selected = (j === focusedOptionIndex) ? 1 : 0;
      }
      storage.setProxyMode(available[focusedOptionIndex].id);
    }
    closeOptions();
    return;
  }

  const saveData: Record<string, any> = {};

  if (item.type === 'list' && item.options) {
    for (let i = 0; i < item.options.length; i++) {
      item.options[i].selected = (i === focusedOptionIndex) ? 1 : 0;
    }
    saveData[item.key] = item.options[focusedOptionIndex].id;
  } else {
    item.value = focusedOptionIndex === 1 ? 1 : 0;
    saveData[item.key] = item.value;
  }

  if (item.key === 'streamingType' && item.options) {
    const stOpt = item.options[focusedOptionIndex];
    storage.setStreamingType(String(stOpt.label || stOpt.id).toLowerCase());
  }

  saveDeviceSettings(saveData);
  closeOptions();
};

const stepSubSize = (dir: number): void => {
  const item = allSettings[focusedIndex];
  if (!item || item.key !== '_subSize') return;
  let size = item.value as number;
  size = Math.max(Storage.SUB_SIZE_MIN, Math.min(Storage.SUB_SIZE_MAX, size + dir * Storage.SUB_SIZE_STEP));
  item.value = size;
  storage.setSubSize(size);
  render();
};

const cycleListOption = (dir: number): void => {
  const item = allSettings[focusedIndex];
  if (!item || item.type !== 'list' || !item.options || item.options.length === 0) return;

  let currentIdx = 0;
  for (let i = 0; i < item.options.length; i++) {
    if (item.options[i].selected) { currentIdx = i; break; }
  }

  const newIdx = currentIdx + dir;
  if (newIdx < 0 || newIdx >= item.options.length) return;

  focusedOptionIndex = newIdx;
  applyOption();
};

const handleKey = sidebar.wrapKeys((e: JQuery.Event): void => {
  if (optionsOpen) {
    handleOptionsKey(e);
    return;
  }

  const item = allSettings[focusedIndex];

  switch (e.keyCode) {
    case TvKey.Return: case TvKey.Backspace: case TvKey.Escape:
      sidebar.backOrFocus(e); break;
    case TvKey.Up:
      if (focusedIndex > 0) { focusedIndex--; render(); }
      e.preventDefault(); break;
    case TvKey.Down:
      if (focusedIndex < allSettings.length - 1) { focusedIndex++; render(); }
      e.preventDefault(); break;
    case TvKey.Left:
      if (item && item.type === 'stepper') { stepSubSize(-1); e.preventDefault(); }
      else if (item && item.type === 'list') { cycleListOption(-1); e.preventDefault(); }
      else { sidebar.focus(); e.preventDefault(); }
      break;
    case TvKey.Right:
      if (item && item.type === 'stepper') { stepSubSize(1); e.preventDefault(); }
      else if (item && item.type === 'list') { cycleListOption(1); e.preventDefault(); }
      break;
    case TvKey.Enter:
      if (item && item.type === 'stepper') { e.preventDefault(); break; }
      openOptions(); e.preventDefault(); break;
  }
});

const openOptions = (): void => {
  const item = allSettings[focusedIndex];
  if (!item) return;

  optionsOpen = true;

  if (item.type === 'list' && item.options) {
    focusedOptionIndex = 0;
    for (let i = 0; i < item.options.length; i++) {
      if (item.options[i].selected) { focusedOptionIndex = i; break; }
    }
  } else {
    focusedOptionIndex = item.value ? 1 : 0;
  }

  renderOptions();
};

const handleOptionsKey = (e: JQuery.Event): void => {
  const item = allSettings[focusedIndex];
  const count = (item.type === 'list' && item.options) ? item.options.length : 2;

  switch (e.keyCode) {
    case TvKey.Up:
      if (focusedOptionIndex > 0) {
        focusedOptionIndex--;
        $root.find('.soptions-overlay').remove();
        renderOptions();
      }
      e.preventDefault(); break;
    case TvKey.Down:
      if (focusedOptionIndex < count - 1) {
        focusedOptionIndex++;
        $root.find('.soptions-overlay').remove();
        renderOptions();
      }
      e.preventDefault(); break;
    case TvKey.Enter:
      applyOption(); e.preventDefault(); break;
    case TvKey.Return: case TvKey.Backspace: case TvKey.Escape:
      closeOptions(); e.preventDefault(); break;
  }
};

export const settingsPage: Page = {
  mount(_params: RouteParams) {
    allSettings = [];
    focusedIndex = 0;
    optionsOpen = false;
    PageUtils.showSpinnerIn($root);

    sidebar.setUnfocusHandler(() => render());

    $.when(getDeviceSettings(), checkVip(true)).then(
      (res: any, isVip: boolean) => {
        const data = Array.isArray(res) ? res[0] : res;
        if (data && data.settings) {
          allSettings = parseSettings(data.settings);
          if (data.settings.streamingType && data.settings.streamingType.value) {
            const stValues = data.settings.streamingType.value;
            for (let si = 0; si < stValues.length; si++) {
              if (stValues[si].selected) { storage.setStreamingType(String(stValues[si].label || stValues[si].id).toLowerCase()); break; }
            }
          }
        }
        vipUser = isVip;
        if (!isVip) storage.downgradeProxyForNonVip();
        allSettings.unshift(buildProxyModeSetting(isVip));
        allSettings.unshift(buildSubSizeSetting());
        allSettings.unshift(buildQualitySetting());
        allSettings.unshift(buildStartPageSetting());
        render();
      },
      () => {
        $root.html('<div class="settings-page"><div class="settings-page__title">Ошибка загрузки настроек</div></div>');
      }
    );

    keys.bind(handleKey);
  },

  unmount() {
    keys.unbind();
    PageUtils.clearPage($root);
    sidebar.setUnfocusHandler(null);
    allSettings = [];
  }
};
