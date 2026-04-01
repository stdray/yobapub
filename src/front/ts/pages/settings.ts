import $ from 'jquery';
import * as doT from 'dot';
import { RouteParams } from '../types/app';
import { deviceApi } from '../api/device';
import { DeviceSettingsResponse } from '../types/api';
import { TvKey, platform } from '../utils/platform';
import { storage, Storage } from '../utils/storage';
import { PageUtils } from '../utils/page';
import { sidebar } from '../sidebar';
import { SidebarPage } from './sidebar-page';

interface SettingOption {
  id: number;
  label: string;
  description: string;
  selected: number;
}

interface SettingItem {
  key: string;
  label: string;
  type: string;
  value: number | string | null;
  options?: SettingOption[];
}

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

const buildSubSizeSetting = (): SettingItem => ({
  key: '_subSize', label: 'Размер субтитров', type: 'stepper', value: storage.getSubSize()
});

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

class SettingsPage extends SidebarPage {
  private allSettings: SettingItem[] = [];
  private focusedIndex = 0;
  private focusedOptionIndex = 0;
  private optionsOpen = false;
  private vipUser = false;

  constructor() { super('settings'); }

  protected onUnfocus(): void { this.render(); }

  protected onMount(_params: RouteParams): void {
    this.allSettings = [];
    this.focusedIndex = 0;
    this.optionsOpen = false;
    PageUtils.showSpinnerIn(this.$root);

    $.when(deviceApi.getDeviceSettings(), deviceApi.checkVip(true)).then(
      (res: any, isVip: any) => {
        const data: DeviceSettingsResponse = Array.isArray(res) ? res[0] : res;
        const vip: boolean = Array.isArray(isVip) ? isVip[0] : isVip;
        if (data && data.settings) {
          this.allSettings = parseSettings(data.settings);
          if (data.settings.streamingType && data.settings.streamingType.value) {
            const stValues = data.settings.streamingType.value;
            for (let si = 0; si < stValues.length; si++) {
              if (stValues[si].selected) { storage.setStreamingType(String(stValues[si].label || stValues[si].id).toLowerCase()); break; }
            }
          }
        }
        this.vipUser = vip;
        if (!vip) storage.downgradeProxyForNonVip();
        this.allSettings.unshift(buildProxyModeSetting(vip));
        this.allSettings.unshift(buildSubSizeSetting());
        this.allSettings.unshift(buildQualitySetting());
        this.allSettings.unshift(buildStartPageSetting());
        this.render();
      },
      () => {
        this.$root.html('<div class="settings-page"><div class="settings-page__title">Ошибка загрузки настроек</div></div>');
      }
    );
  }

  protected onUnmount(): void {
    this.allSettings = [];
  }

  protected handleKey(e: JQuery.Event): void {
    if (this.optionsOpen) {
      this.handleOptionsKey(e);
      return;
    }

    const item = this.allSettings[this.focusedIndex];

    switch (e.keyCode) {
      case TvKey.Return: case TvKey.Backspace: case TvKey.Escape:
        sidebar.backOrFocus(e); break;
      case TvKey.Up:
        if (this.focusedIndex > 0) { this.focusedIndex--; this.render(); }
        e.preventDefault(); break;
      case TvKey.Down:
        if (this.focusedIndex < this.allSettings.length - 1) { this.focusedIndex++; this.render(); }
        e.preventDefault(); break;
      case TvKey.Left:
        if (item && item.type === 'stepper') { this.stepSubSize(-1); e.preventDefault(); }
        else if (item && item.type === 'list') { this.cycleListOption(-1); e.preventDefault(); }
        else { sidebar.focus(); e.preventDefault(); }
        break;
      case TvKey.Right:
        if (item && item.type === 'stepper') { this.stepSubSize(1); e.preventDefault(); }
        else if (item && item.type === 'list') { this.cycleListOption(1); e.preventDefault(); }
        break;
      case TvKey.Enter:
        if (item && item.type === 'stepper') { e.preventDefault(); break; }
        this.openOptions(); e.preventDefault(); break;
    }
  }

  private render(): void {
    let html = '';
    for (let i = 0; i < this.allSettings.length; i++) {
      html += tplSettingItem({
        idx: i,
        label: this.allSettings[i].label,
        value: getDisplayValue(this.allSettings[i]),
        focused: !this.optionsOpen && i === this.focusedIndex,
        stepper: this.allSettings[i].type === 'stepper'
      });
    }
    this.$root.html(tplPage({ items: html, version: __APP_VERSION__ }));
  }

  private renderOptions(): void {
    const item = this.allSettings[this.focusedIndex];
    if (!item) return;

    if (item.type === 'list' && item.options) {
      const opts = item.options.map((o) => ({
        label: o.label, selected: o.selected === 1
      }));
      this.$root.find('.settings-page__list').append(
        '<div class="soptions-overlay">' +
        tplOptions({ title: item.label, options: opts, focused: this.focusedOptionIndex }) +
        '</div>'
      );
    } else {
      const checkOpts = [
        { label: 'Выкл', selected: !item.value },
        { label: 'Вкл', selected: !!item.value }
      ];
      this.$root.find('.settings-page__list').append(
        '<div class="soptions-overlay">' +
        tplOptions({ title: item.label, options: checkOpts, focused: this.focusedOptionIndex }) +
        '</div>'
      );
    }
  }

  private closeOptions(): void {
    this.optionsOpen = false;
    this.$root.find('.soptions-overlay').remove();
    this.render();
  }

  private openOptions(): void {
    const item = this.allSettings[this.focusedIndex];
    if (!item) return;

    this.optionsOpen = true;

    if (item.type === 'list' && item.options) {
      this.focusedOptionIndex = 0;
      for (let i = 0; i < item.options.length; i++) {
        if (item.options[i].selected) { this.focusedOptionIndex = i; break; }
      }
    } else {
      this.focusedOptionIndex = item.value ? 1 : 0;
    }

    this.renderOptions();
  }

  private applyOption(): void {
    const item = this.allSettings[this.focusedIndex];
    if (!item) return;

    if (item.key === '_defaultQuality') {
      if (item.options) {
        for (let j = 0; j < item.options.length; j++) {
          item.options[j].selected = (j === this.focusedOptionIndex) ? 1 : 0;
        }
        storage.setDefaultQuality(item.options[this.focusedOptionIndex].id);
      }
      this.closeOptions();
      return;
    }

    if (item.key === '_startPage') {
      if (item.options) {
        for (let k = 0; k < item.options.length; k++) {
          item.options[k].selected = (k === this.focusedOptionIndex) ? 1 : 0;
        }
        storage.setStartPage(Storage.START_PAGE_OPTIONS[this.focusedOptionIndex].id);
      }
      this.closeOptions();
      return;
    }

    if (item.key === '_proxyMode') {
      if (item.options) {
        const available = storage.getAvailableProxyModes(this.vipUser);
        for (let j = 0; j < item.options.length; j++) {
          item.options[j].selected = (j === this.focusedOptionIndex) ? 1 : 0;
        }
        storage.setProxyMode(available[this.focusedOptionIndex].id);
      }
      this.closeOptions();
      return;
    }

    const saveData: Record<string, number | string> = {};

    if (item.type === 'list' && item.options) {
      for (let i = 0; i < item.options.length; i++) {
        item.options[i].selected = (i === this.focusedOptionIndex) ? 1 : 0;
      }
      saveData[item.key] = item.options[this.focusedOptionIndex].id;
    } else {
      item.value = this.focusedOptionIndex === 1 ? 1 : 0;
      saveData[item.key] = item.value;
    }

    if (item.key === 'streamingType' && item.options) {
      const stOpt = item.options[this.focusedOptionIndex];
      storage.setStreamingType(String(stOpt.label || stOpt.id).toLowerCase());
    }

    deviceApi.saveDeviceSettings(saveData);
    this.closeOptions();
  }

  private stepSubSize(dir: number): void {
    const item = this.allSettings[this.focusedIndex];
    if (!item || item.key !== '_subSize') return;
    let size = item.value as number;
    size = Math.max(Storage.SUB_SIZE_MIN, Math.min(Storage.SUB_SIZE_MAX, size + dir * Storage.SUB_SIZE_STEP));
    item.value = size;
    storage.setSubSize(size);
    this.render();
  }

  private cycleListOption(dir: number): void {
    const item = this.allSettings[this.focusedIndex];
    if (!item || item.type !== 'list' || !item.options || item.options.length === 0) return;

    let currentIdx = 0;
    for (let i = 0; i < item.options.length; i++) {
      if (item.options[i].selected) { currentIdx = i; break; }
    }

    const newIdx = currentIdx + dir;
    if (newIdx < 0 || newIdx >= item.options.length) return;

    this.focusedOptionIndex = newIdx;
    this.applyOption();
  }

  private handleOptionsKey(e: JQuery.Event): void {
    const item = this.allSettings[this.focusedIndex];
    const count = (item.type === 'list' && item.options) ? item.options.length : 2;

    switch (e.keyCode) {
      case TvKey.Up:
        if (this.focusedOptionIndex > 0) {
          this.focusedOptionIndex--;
          this.$root.find('.soptions-overlay').remove();
          this.renderOptions();
        }
        e.preventDefault(); break;
      case TvKey.Down:
        if (this.focusedOptionIndex < count - 1) {
          this.focusedOptionIndex++;
          this.$root.find('.soptions-overlay').remove();
          this.renderOptions();
        }
        e.preventDefault(); break;
      case TvKey.Enter:
        this.applyOption(); e.preventDefault(); break;
      case TvKey.Return: case TvKey.Backspace: case TvKey.Escape:
        this.closeOptions(); e.preventDefault(); break;
    }
  }
}

export const settingsPage = new SettingsPage();
