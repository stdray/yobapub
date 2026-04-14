import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { deviceApi } from '../api/device';
import { DeviceSetting, DeviceSettingsResponse } from '../types/api';
import { TvKey, platform } from '../utils/platform';
import { storage, Storage, QualityId } from '../utils/storage';
import { PageKeys, PageUtils } from '../utils/page';
import { formatAppVersion } from '../utils/format';
import { router } from '../router';
import { Logger } from '../utils/log';

const slog = new Logger('settings-diag');

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
  value: number | string | boolean | null;
  options?: SettingOption[];
}

type SettingKey =
  | 'serverLocation' | 'streamingType' | 'supportSsl'
  | 'supportHevc' | 'supportHdr' | 'support4k' | 'mixedPlaylist';

const DISPLAY_KEYS: Readonly<Record<SettingKey, true>> = {
  serverLocation: true,
  streamingType: true,
  supportSsl: true,
  supportHevc: true,
  supportHdr: true,
  support4k: true,
  mixedPlaylist: true,
};

const LABELS: Readonly<Record<SettingKey, string>> = {
  serverLocation: 'Сервер',
  streamingType: 'Тип стриминга',
  supportSsl: 'SSL',
  supportHevc: 'HEVC',
  supportHdr: 'HDR',
  support4k: '4K',
  mixedPlaylist: 'Смешанный плейлист',
};

const tplPageCompiled = doT.template(`
  <div class="settings-page">
    <div class="settings-page__title">Настройки</div>
    <div class="settings-page__list">{{=it.items}}</div>
  </div>
`);

const tplPage = (data: { readonly items: string }): string =>
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

interface SettingItemData {
  readonly idx: number;
  readonly label: string;
  readonly value: string;
  readonly focused: boolean;
  readonly stepper: boolean;
}

const tplSettingItem = (data: SettingItemData): string =>
  tplSettingItemCompiled(data);

const tplOptionsCompiled = doT.template(`
  <div class="soptions">
    <div class="soptions__title">{{=it.title}}</div>
    {{~it.options :opt:i}}
      <div class="soptions__item{{?opt.selected}} selected{{?}}{{?i===it.focused}} focused{{?}}" data-oi="{{=i}}">{{=opt.label}}</div>
    {{~}}
  </div>
`);

interface OptionsData {
  readonly title: string;
  readonly options: ReadonlyArray<{ readonly label: string; readonly selected: boolean }>;
  readonly focused: number;
}

const tplOptions = (data: OptionsData): string =>
  tplOptionsCompiled(data);

const parseListOptions = (key: string, setting: DeviceSetting): SettingOption[] => {
  if (!Array.isArray(setting.value)) return [];
  const opts: SettingOption[] = [];
  for (let i = 0; i < setting.value.length; i++) {
    const v = setting.value[i];
    const optLabel = String(v.label || v.id || '').toLowerCase();
    if (key === 'streamingType' && optLabel === 'http') continue;
    if (key === 'streamingType' && platform.isLegacyTizen() && optLabel === 'hls4') continue;
    opts.push({ id: v.id, label: v.label, description: v.description || '', selected: v.selected });
  }
  return opts;
};

const isSettingKey = (key: string): key is SettingKey => key in DISPLAY_KEYS;

const parseSettings = (raw: Record<string, DeviceSetting>): SettingItem[] => {
  const items: SettingItem[] = [];
  for (const key of Object.keys(raw)) {
    if (!isSettingKey(key)) continue;
    const setting = raw[key];
    const label = LABELS[key] || (setting.label || key);
    if (setting.type === 'list') {
      items.push({ key, label, type: 'list', value: null, options: parseListOptions(key, setting) });
    } else {
      const val = typeof setting.value === 'boolean' ? setting.value : null;
      items.push({ key, label, type: 'checkbox', value: val });
    }
  }
  return items;
};

const buildQualitySetting = (): SettingItem => {
  let savedId = storage.getDefaultQuality();
  if (savedId === -1) {
    savedId = QualityId.HD;
    storage.setDefaultQuality(savedId);
  }
  const opts: SettingOption[] = [];
  for (let i = 0; i < Storage.QUALITY_OPTIONS.length; i++) {
    const q = Storage.QUALITY_OPTIONS[i];
    opts.push({ id: q.id, label: q.label, description: '', selected: q.id === savedId ? 1 : 0 });
  }
  return { key: '_defaultQuality', label: 'Качество по умолчанию', type: 'list', value: null, options: opts };
};

const buildVersionSetting = (): SettingItem => {
  return { key: '_version', label: 'Версия', type: 'readonly', value: formatAppVersion() };
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
  if (item.type === 'readonly') return String(item.value ?? '');
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

class SettingsPage implements Page {
  private readonly $root = $('#page-settings');
  private readonly keys = new PageKeys();
  private allSettings: SettingItem[] = [];
  private focusedIndex = 0;
  private focusedOptionIndex = 0;
  private optionsOpen = false;
  private vipUser = false;

  mount(_params: RouteParams): void {
    this.allSettings = [];
    this.focusedIndex = 0;
    this.optionsOpen = false;
    this.keys.bind((e) => this.handleKey(e));
    PageUtils.showSpinnerIn(this.$root);

    slog.info('mount start');
    $.when(deviceApi.getDeviceSettings(), deviceApi.checkVip(true)).then(
      (...args: unknown[]) => {
        try {
          slog.info('settings+vip resolved argsLen={n}', { n: args.length });
          const res = args[0] as [DeviceSettingsResponse, string, JQueryXHR] | DeviceSettingsResponse;
          const isVip = args[1] as [boolean, string, JQueryXHR] | boolean;
          const data: DeviceSettingsResponse = Array.isArray(res) ? res[0] : res;
          const vip: boolean = Array.isArray(isVip) ? isVip[0] : isVip;
          slog.info('parsed hasData={hd} hasSettings={hs} vip={vip}', {
            hd: !!data, hs: !!(data && data.settings), vip,
          });
          if (data && data.settings) {
            slog.info('before parseSettings');
            this.allSettings = parseSettings(data.settings);
            slog.info('parseSettings ok count={n}', { n: this.allSettings.length });
            if (data.settings.streamingType && Array.isArray(data.settings.streamingType.value)) {
              const stValues = data.settings.streamingType.value;
              for (let si = 0; si < stValues.length; si++) {
                if (stValues[si].selected) { storage.setStreamingType(String(stValues[si].label || stValues[si].id).toLowerCase()); break; }
              }
            }
          }
          this.vipUser = vip;
          if (!vip) storage.downgradeProxyForNonVip();
          slog.info('before unshift builders');
          this.allSettings.unshift(buildProxyModeSetting(vip));
          this.allSettings.unshift(buildSubSizeSetting());
          this.allSettings.unshift(buildQualitySetting());
          this.allSettings.unshift(buildStartPageSetting());
          this.allSettings.unshift(buildVersionSetting());
          slog.info('before render count={n}', { n: this.allSettings.length });
          this.render();
          slog.info('render ok');
        } catch (e) {
          const err = e as Error;
          slog.error('settings handler threw: {msg} stack={stack}', {
            msg: err && err.message ? err.message : String(e),
            stack: err && err.stack ? err.stack.substring(0, 600) : '',
          });
          this.$root.html('<div class="settings-page"><div class="settings-page__title">Ошибка инициализации настроек</div></div>');
        }
      },
      (...errArgs: unknown[]) => {
        const xhr = errArgs[0] as JQueryXHR | undefined;
        slog.error('settings+vip failed status={status} text={text} resp={resp}', {
          status: xhr && xhr.status !== undefined ? xhr.status : -1,
          text: xhr && xhr.statusText ? String(xhr.statusText) : '',
          resp: xhr && xhr.responseText ? String(xhr.responseText).substring(0, 200) : '',
        });
        this.$root.html('<div class="settings-page"><div class="settings-page__title">Ошибка загрузки настроек</div></div>');
      }
    );
  }

  unmount(): void {
    this.keys.unbind();
    PageUtils.clearPage(this.$root);
    this.allSettings = [];
  }

  private handleKey(e: JQuery.Event): void {
    if (this.optionsOpen) {
      this.handleOptionsKey(e);
      return;
    }

    const item = this.allSettings[this.focusedIndex];

    switch (e.keyCode) {
      case TvKey.Return: case TvKey.Backspace: case TvKey.Escape:
        router.navigateToStartPage();
        e.preventDefault(); break;
      case TvKey.Up:
        if (this.focusedIndex > 0) { this.focusedIndex--; this.render(); }
        e.preventDefault(); break;
      case TvKey.Down:
        if (this.focusedIndex < this.allSettings.length - 1) { this.focusedIndex++; this.render(); }
        e.preventDefault(); break;
      case TvKey.Left:
        if (item && item.type === 'stepper') { this.stepSubSize(-1); e.preventDefault(); }
        else if (item && item.type === 'list') { this.cycleListOption(-1); e.preventDefault(); }
        else { e.preventDefault(); }
        break;
      case TvKey.Right:
        if (item && item.type === 'stepper') { this.stepSubSize(1); e.preventDefault(); }
        else if (item && item.type === 'list') { this.cycleListOption(1); e.preventDefault(); }
        else { e.preventDefault(); }
        break;
      case TvKey.Enter:
        if (item && (item.type === 'stepper' || item.type === 'readonly')) { e.preventDefault(); break; }
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
    this.$root.html(tplPage({ items: html }));
    const $focused = this.$root.find('.sitem.focused');
    if ($focused.length) {
      PageUtils.scrollIntoView($focused[0], this.$root.find('.settings-page')[0]);
    }
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
