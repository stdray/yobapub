import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { getDeviceSettings, saveDeviceSettings } from '../api/device';
import { goBack } from '../router';
import { TvKey, isLegacyTizen } from '../utils/platform';
import { getDefaultQuality, setDefaultQuality, QUALITY_OPTIONS, getSubSize, setSubSize, SUB_SIZE_STEP, SUB_SIZE_MIN, SUB_SIZE_MAX, DEFAULT_SUB_SIZE, setStreamingType, isProxyEnabled, setProxyEnabled, isProxyAll, setProxyAll } from '../utils/storage';
import { pageKeys, showSpinnerIn, clearPage } from '../utils/page';

var $root = $('#page-settings');
var keys = pageKeys();

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

var allSettings: SettingItem[] = [];
var focusedIndex = 0;
var focusedOptionIndex = 0;
var optionsOpen = false;

var DISPLAY_KEYS: Record<string, boolean> = {
  serverLocation: true,
  streamingType: true,
  supportSsl: true,
  supportHevc: true,
  supportHdr: true,
  support4k: true,
  mixedPlaylist: true
};

var LABELS: Record<string, string> = {
  serverLocation: 'Сервер',
  streamingType: 'Тип стриминга',
  supportSsl: 'SSL',
  supportHevc: 'HEVC',
  supportHdr: 'HDR',
  support4k: '4K',
  mixedPlaylist: 'Смешанный плейлист'
};

var tplPage = doT.template(
  '<div class="settings-page">' +
    '<div class="settings-page__title">Настройки</div>' +
    '<div class="settings-page__list">{{=it.items}}</div>' +
    '<div class="settings-page__hint">' +
      '<span class="hint-key hint-key--red"></span> Уменьшить субтитры &nbsp;&nbsp; ' +
      '<span class="hint-key hint-key--green"></span> Увеличить субтитры &nbsp;&nbsp; (во время воспроизведения)' +
    '</div>' +
    '<div class="settings-page__version">{{=it.version}}</div>' +
  '</div>'
);

var tplSettingItem = doT.template(
  '<div class="sitem{{?it.focused}} focused{{?}}{{?it.stepper}} sitem--stepper{{?}}" data-idx="{{=it.idx}}">' +
    '<span class="sitem__label">{{=it.label}}</span>' +
    '{{?it.stepper}}' +
      '<span class="sitem__stepper">' +
        '<span class="sitem__step-btn sitem__step-btn--minus">&minus;</span>' +
        '<span class="sitem__step-val">{{=it.value}}</span>' +
        '<span class="sitem__step-btn sitem__step-btn--plus">+</span>' +
      '</span>' +
    '{{??}}' +
      '<span class="sitem__value">{{=it.value}}</span>' +
    '{{?}}' +
  '</div>'
);

var tplOptions = doT.template(
  '<div class="soptions">' +
    '<div class="soptions__title">{{=it.title}}</div>' +
    '{{~it.options :opt:i}}' +
      '<div class="soptions__item{{?opt.selected}} selected{{?}}{{?i===it.focused}} focused{{?}}" data-oi="{{=i}}">{{=opt.label}}</div>' +
    '{{~}}' +
  '</div>'
);

function parseSettings(raw: Record<string, any>): SettingItem[] {
  var items: SettingItem[] = [];
  for (var key in raw) {
    if (!raw.hasOwnProperty(key)) continue;
    if (!DISPLAY_KEYS[key]) continue;

    var setting = raw[key];
    var label = LABELS[key] || (setting.label || key);

    if (setting.type === 'list') {
      var opts: SettingOption[] = [];
      if (Array.isArray(setting.value)) {
        for (var i = 0; i < setting.value.length; i++) {
          var optLabel = String(setting.value[i].label || setting.value[i].id || '').toLowerCase();
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
  var savedId = getDefaultQuality();
  if (savedId === -1) {
    savedId = isLegacyTizen() ? 3 : 0;
    setDefaultQuality(savedId);
  }
  var opts: SettingOption[] = [];
  for (var i = 0; i < QUALITY_OPTIONS.length; i++) {
    var q = QUALITY_OPTIONS[i];
    opts.push({ id: q.id, label: q.label, description: '', selected: q.id === savedId ? 1 : 0 });
  }
  return { key: '_defaultQuality', label: 'Качество по умолчанию', type: 'list', value: null, options: opts };
}

function buildSubSizeSetting(): SettingItem {
  return { key: '_subSize', label: 'Размер субтитров', type: 'stepper', value: getSubSize() };
}

function buildProxySetting(): SettingItem {
  return { key: '_proxy', label: 'Прокси', type: 'checkbox', value: isProxyEnabled() ? 1 : 0 };
}

function buildProxyAllSetting(): SettingItem {
  return { key: '_proxyAll', label: 'Проксировать видео', type: 'checkbox', value: isProxyAll() ? 1 : 0 };
}

function getDisplayValue(item: SettingItem): string {
  if (item.type === 'stepper') {
    var v = item.value as number;
    var lbl = v + 'px';
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
  var html = '';
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
  var item = allSettings[focusedIndex];
  if (!item) return;

  if (item.type === 'list' && item.options) {
    var opts = item.options.map(function (o) {
      return { label: o.label, selected: o.selected === 1 };
    });
    $root.find('.settings-page__list').append(
      '<div class="soptions-overlay">' +
      tplOptions({ title: item.label, options: opts, focused: focusedOptionIndex }) +
      '</div>'
    );
  } else {
    var checkOpts = [
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
  var item = allSettings[focusedIndex];
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

  if (item.key === '_proxy') {
    item.value = focusedOptionIndex === 1 ? 1 : 0;
    setProxyEnabled(!!item.value);
    closeOptions();
    return;
  }

  if (item.key === '_proxyAll') {
    item.value = focusedOptionIndex === 1 ? 1 : 0;
    setProxyAll(!!item.value);
    closeOptions();
    return;
  }



  var saveData: Record<string, any> = {};

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
    var stOpt = item.options[focusedOptionIndex];
    setStreamingType(String(stOpt.label || stOpt.id).toLowerCase());
  }

  saveDeviceSettings(saveData);
  closeOptions();
}

function stepSubSize(dir: number): void {
  var item = allSettings[focusedIndex];
  if (!item || item.key !== '_subSize') return;
  var size = item.value as number;
  size = Math.max(SUB_SIZE_MIN, Math.min(SUB_SIZE_MAX, size + dir * SUB_SIZE_STEP));
  item.value = size;
  setSubSize(size);
  render();
}

function handleKey(e: JQuery.Event): void {
  if (optionsOpen) {
    handleOptionsKey(e);
    return;
  }

  var item = allSettings[focusedIndex];

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
      break;
    case TvKey.Right:
      if (item && item.type === 'stepper') { stepSubSize(1); e.preventDefault(); }
      break;
    case TvKey.Enter:
      if (item && item.type === 'stepper') { e.preventDefault(); break; }
      openOptions(); e.preventDefault(); break;
  }
}

function openOptions(): void {
  var item = allSettings[focusedIndex];
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
  var item = allSettings[focusedIndex];
  var count = (item.type === 'list' && item.options) ? item.options.length : 2;

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

    getDeviceSettings().then(
      function (res: any) {
        var data = Array.isArray(res) ? res[0] : res;
        if (data && data.settings) {
          allSettings = parseSettings(data.settings);
          if (data.settings.streamingType && data.settings.streamingType.value) {
            var stValues = data.settings.streamingType.value;
            for (var si = 0; si < stValues.length; si++) {
              if (stValues[si].selected) { setStreamingType(String(stValues[si].label || stValues[si].id).toLowerCase()); break; }
            }
          }
        }
        allSettings.unshift(buildProxyAllSetting());
        allSettings.unshift(buildProxySetting());
        allSettings.unshift(buildSubSizeSetting());
        allSettings.unshift(buildQualitySetting());
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
