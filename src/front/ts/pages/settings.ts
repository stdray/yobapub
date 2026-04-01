import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { getDeviceSettings, saveDeviceSettings, checkVip } from '../api/device';
import { goBack } from '../router';
import { TvKey, isLegacyTizen } from '../utils/platform';
import { getDefaultQuality, setDefaultQuality, QUALITY_OPTIONS, getSubSize, setSubSize, SUB_SIZE_STEP, SUB_SIZE_MIN, SUB_SIZE_MAX, DEFAULT_SUB_SIZE, setStreamingType, setProxyAll, getStartPage, setStartPage, START_PAGE_OPTIONS, getProxyMode, setProxyMode, PROXY_MODE_OPTIONS } from '../utils/storage';
import { pageKeys, showSpinnerIn, clearPage } from '../utils/page';

const $root = $('#page-settings');
const keys = pageKeys();

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

export const tplPage = (data: { readonly items: string; readonly version: string }): string =>
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

export const tplSettingItem = (data: { readonly idx: number; readonly label: string; readonly value: string; readonly focused: boolean; readonly stepper: boolean }): string =>
  tplSettingItemCompiled(data);

const tplOptionsCompiled = doT.template(`
  <div class="soptions">
    <div class="soptions__title">{{=it.title}}</div>
    {{~it.options :opt:i}}
      <div class="soptions__item{{?opt.selected}} selected{{?}}{{?i===it.focused}} focused{{?}}" data-oi="{{=i}}">{{=opt.label}}</div>
    {{~}}
  </div>
`);

export const tplOptions = (data: { readonly title: string; readonly options: Array<{ readonly label: string; readonly selected: boolean }>; readonly focused: number }): string =>
  tplOptionsCompiled(data);

function parseSettings(raw: Record<string, any>): SettingItem[] {
  const items: SettingItem[] = [];
  for (var key in raw) {
    if (!raw.hasOwnProperty(key)) continue;
    if (!DISPLAY_KEYS[key]) continue;

    const setting = raw[key];
    let label = LABELS[key] || (setting.label || key);

    if (setting.type === 'list') {
      const opts: SettingOption[] = [];
      if (Array.isArray(setting.value)) {
        for (var i = 0; i < setting.value.length; i++) {
          const optLabel = String(setting.value[i].label || setting.value[i].id || '').toLowerCase();
          if (key === 'streamingType' && optLabel === 'http') continue;
          if (key === 'streamingType' && isLegacyTizen() && optLabel === 'hls4') continue;
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
}

function buildQualitySetting(): SettingItem {
  let savedId = getDefaultQuality();
  if (savedId === -1) {
    savedId = isLegacyTizen() ? 3 : 0;
    setDefaultQuality(savedId);
  }
  const opts: SettingOption[] = [];
  for (var i = 0; i < QUALITY_OPTIONS.length; i++) {
    const q = QUALITY_OPTIONS[i];
    opts.push({ id: q.id, label: q.label, description: '', selected: q.id === savedId ? 1 : 0 });
  }
  return { key: '_defaultQuality', label: 'Качество по умолчанию', type: 'list', value: null, options: opts };
}

function buildSubSizeSetting(): SettingItem {
  return { key: '_subSize', label: 'Размер субтитров', type: 'stepper', value: getSubSize() };
}

function buildStartPageSetting(): SettingItem {
  let savedId = getStartPage();
  const opts: SettingOption[] = [];
  for (var i = 0; i < START_PAGE_OPTIONS.length; i++) {
    const o = START_PAGE_OPTIONS[i];
    opts.push({ id: i, label: o.label, description: '', selected: o.id === savedId ? 1 : 0 });
  }
  return { key: '_startPage', label: 'Стартовая страница', type: 'list', value: null, options: opts };
}

function buildProxyModeSetting(isVip: boolean): SettingItem {
  const mode = getProxyMode();
  const available = isVip ? PROXY_MODE_OPTIONS : PROXY_MODE_OPTIONS.filter((o) => o.id !== 'all');
  const opts: SettingOption[] = available.map((o, i) => ({
    id: i,
    label: o.label,
    description: '',
    selected: o.id === mode ? 1 : 0,
  }));
  return { key: '_proxyMode', label: 'Проксировать', type: 'list', value: null, options: opts };
}

function getDisplayValue(item: SettingItem): string {
  if (item.type === 'stepper') {
    const v = item.value as number;
    let lbl = v + 'px';
    if (v === DEFAULT_SUB_SIZE) lbl += ' (стандарт)';
    return lbl;
  }
  if (item.type === 'list' && item.options) {
    for (var i = 0; i < item.options.length; i++) {
      if (item.options[i].selected) return item.options[i].label;
    }
    return '—';
  }
  return item.value ? 'Вкл' : 'Выкл';
}

function render(): void {
  let html = '';
  for (var i = 0; i < allSettings.length; i++) {
    html += tplSettingItem({
      idx: i,
      label: allSettings[i].label,
      value: getDisplayValue(allSettings[i]),
      focused: !optionsOpen && i === focusedIndex,
      stepper: allSettings[i].type === 'stepper'
    });
  }
  $root.html(tplPage({ items: html, version: __APP_VERSION__ }));
}

function renderOptions(): void {
  const item = allSettings[focusedIndex];
  if (!item) return;

  if (item.type === 'list' && item.options) {
    const opts = item.options.map(function (o) {
      return { label: o.label, selected: o.selected === 1 };
    });
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
}

function closeOptions(): void {
  optionsOpen = false;
  $root.find('.soptions-overlay').remove();
  render();
}

function applyOption(): void {
  const item = allSettings[focusedIndex];
  if (!item) return;

  if (item.key === '_defaultQuality') {
    if (item.options) {
      for (var j = 0; j < item.options.length; j++) {
        item.options[j].selected = (j === focusedOptionIndex) ? 1 : 0;
      }
      setDefaultQuality(item.options[focusedOptionIndex].id);
    }
    closeOptions();
    return;
  }

  if (item.key === '_startPage') {
    if (item.options) {
      for (var k = 0; k < item.options.length; k++) {
        item.options[k].selected = (k === focusedOptionIndex) ? 1 : 0;
      }
      setStartPage(START_PAGE_OPTIONS[focusedOptionIndex].id);
    }
    closeOptions();
    return;
  }

  if (item.key === '_proxyMode') {
    if (item.options) {
      const available = vipUser ? PROXY_MODE_OPTIONS : PROXY_MODE_OPTIONS.filter((o) => o.id !== 'all');
      for (let j = 0; j < item.options.length; j++) {
        item.options[j].selected = (j === focusedOptionIndex) ? 1 : 0;
      }
      setProxyMode(available[focusedOptionIndex].id);
    }
    closeOptions();
    return;
  }



  const saveData: Record<string, any> = {};

  if (item.type === 'list' && item.options) {
    for (var i = 0; i < item.options.length; i++) {
      item.options[i].selected = (i === focusedOptionIndex) ? 1 : 0;
    }
    saveData[item.key] = item.options[focusedOptionIndex].id;
  } else {
    item.value = focusedOptionIndex === 1 ? 1 : 0;
    saveData[item.key] = item.value;
  }

  if (item.key === 'streamingType' && item.options) {
    const stOpt = item.options[focusedOptionIndex];
    setStreamingType(String(stOpt.label || stOpt.id).toLowerCase());
  }

  saveDeviceSettings(saveData);
  closeOptions();
}

function stepSubSize(dir: number): void {
  const item = allSettings[focusedIndex];
  if (!item || item.key !== '_subSize') return;
  let size = item.value as number;
  size = Math.max(SUB_SIZE_MIN, Math.min(SUB_SIZE_MAX, size + dir * SUB_SIZE_STEP));
  item.value = size;
  setSubSize(size);
  render();
}

function cycleListOption(dir: number): void {
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
}

function handleKey(e: JQuery.Event): void {
  if (optionsOpen) {
    handleOptionsKey(e);
    return;
  }

  const item = allSettings[focusedIndex];

  switch (e.keyCode) {
    case TvKey.Return: case TvKey.Backspace: case TvKey.Escape:
      goBack(); e.preventDefault(); break;
    case TvKey.Up:
      if (focusedIndex > 0) { focusedIndex--; render(); }
      e.preventDefault(); break;
    case TvKey.Down:
      if (focusedIndex < allSettings.length - 1) { focusedIndex++; render(); }
      e.preventDefault(); break;
    case TvKey.Left:
      if (item && item.type === 'stepper') { stepSubSize(-1); e.preventDefault(); }
      else if (item && item.type === 'list') { cycleListOption(-1); e.preventDefault(); }
      break;
    case TvKey.Right:
      if (item && item.type === 'stepper') { stepSubSize(1); e.preventDefault(); }
      else if (item && item.type === 'list') { cycleListOption(1); e.preventDefault(); }
      break;
    case TvKey.Enter:
      if (item && item.type === 'stepper') { e.preventDefault(); break; }
      openOptions(); e.preventDefault(); break;
  }
}

function openOptions(): void {
  const item = allSettings[focusedIndex];
  if (!item) return;

  optionsOpen = true;

  if (item.type === 'list' && item.options) {
    focusedOptionIndex = 0;
    for (var i = 0; i < item.options.length; i++) {
      if (item.options[i].selected) { focusedOptionIndex = i; break; }
    }
  } else {
    focusedOptionIndex = item.value ? 1 : 0;
  }

  renderOptions();
}

function handleOptionsKey(e: JQuery.Event): void {
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
}

export var settingsPage: Page = {
  mount: function (_params: RouteParams) {
    allSettings = [];
    focusedIndex = 0;
    optionsOpen = false;
    showSpinnerIn($root);

    $.when(getDeviceSettings(), checkVip(true)).then(
      function (res: any, isVip: boolean) {
        const data = Array.isArray(res) ? res[0] : res;
        if (data && data.settings) {
          allSettings = parseSettings(data.settings);
          if (data.settings.streamingType && data.settings.streamingType.value) {
            const stValues = data.settings.streamingType.value;
            for (var si = 0; si < stValues.length; si++) {
              if (stValues[si].selected) { setStreamingType(String(stValues[si].label || stValues[si].id).toLowerCase()); break; }
            }
          }
        }
        vipUser = isVip;
        if (!isVip) setProxyAll(false);
        allSettings.unshift(buildProxyModeSetting(isVip));
        allSettings.unshift(buildSubSizeSetting());
        allSettings.unshift(buildQualitySetting());
        allSettings.unshift(buildStartPageSetting());
        render();
      },
      function () {
        $root.html('<div class="settings-page"><div class="settings-page__title">Ошибка загрузки настроек</div></div>');
      }
    );

    keys.bind(handleKey);
  },

  unmount: function () {
    keys.unbind();
    clearPage($root);
    allSettings = [];
  }
};
