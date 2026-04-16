import { RouteName } from '../types/app';
import { DeviceSetting } from '../types/api';

type DeviceSettingValue = boolean | string | number;
type DeviceSettingsMap = Record<string, DeviceSettingValue>;

// Flatten a raw /v1/device/settings response into a plain key→value map:
// checkbox → boolean, list → the selected option's id (string/number),
// anything unexpected is skipped. This is what gets cached in localStorage.
const flattenDeviceSettings = (raw: Record<string, DeviceSetting>): DeviceSettingsMap => {
  const out: DeviceSettingsMap = {};
  const keys = Object.keys(raw);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const v = raw[k].value;
    if (typeof v === 'boolean') out[k] = v;
    else if (typeof v === 'number') out[k] = v !== 0;
    else if (Array.isArray(v)) {
      for (let j = 0; j < v.length; j++) {
        if (v[j].selected) { out[k] = v[j].id; break; }
      }
    }
  }
  return out;
};

// Bitflag enum — categories are OR-combined into a single number stored in
// localStorage. VIP_ONLY_CATS is the mask of premium categories, making the
// VIP check a single bitwise AND.
export const enum ProxyCategory {
  Posters   = 1 << 0,
  Subtitles = 1 << 1,
  Tv        = 1 << 2,
  Media     = 1 << 3,
}

const VIP_ONLY_CATS: number = ProxyCategory.Tv | ProxyCategory.Media;
const DEFAULT_CATS: number = ProxyCategory.Posters | ProxyCategory.Subtitles;
const ALL_CATS: ReadonlyArray<ProxyCategory> = [
  ProxyCategory.Posters,
  ProxyCategory.Subtitles,
  ProxyCategory.Tv,
  ProxyCategory.Media,
];

const PROXY_CATEGORY_LABELS: Readonly<Record<ProxyCategory, string>> = {
  [ProxyCategory.Posters]:   'постеры',
  [ProxyCategory.Subtitles]: 'субтитры',
  [ProxyCategory.Tv]:        'ТВ',
  [ProxyCategory.Media]:     'видео/аудио',
};

export const proxyCategoryLabel = (cat: ProxyCategory): string => PROXY_CATEGORY_LABELS[cat];

export const enum QualityId {
  Auto = 0,
  UHD = 1,
  FullHD = 2,
  HD = 3,
  SD = 4,
}

export interface TitlePrefs {
  id: number;
  quality?: string;
  audioLang?: string;
  audioAuthorId?: number;
  subLang?: string;
  subForced?: boolean;
  subShift?: number;
}

interface QualityOption {
  readonly id: number;
  readonly label: string;
  readonly maxH: number;
}

interface StartPageOption {
  readonly id: RouteName;
  readonly label: string;
}

const KEYS = {
  ACCESS_TOKEN: 'kp_access_token',
  REFRESH_TOKEN: 'kp_refresh_token',
  TOKEN_EXPIRES: 'kp_token_expires',
  DEFAULT_QUALITY: 'kp_default_quality',
  SUB_SIZE: 'kp_sub_size',
  STREAMING_TYPE: 'kp_streaming_type',
  PROXY_CATS: 'kp_proxy_cats',
  START_PAGE: 'kp_start_page',
  DEVICE_ID: 'kp_device_id',
  LEGACY_HLS: 'kp_legacy_hls',
  LEGACY_HLS_FORCED: 'kp_legacy_hls_forced',
  DEVICE_SETTINGS: 'kp_device_settings'
} as const;

// Old per-flag keys — read once during migration, then removed.
const LEGACY_PROXY_KEYS = {
  ALL: 'kp_proxy_all',
  TV: 'kp_proxy_tv',
  POSTERS: 'kp_proxy_posters',
} as const;

type StreamingType = 'hls' | 'hls2' | 'hls4';
const STREAMING_TYPES: { readonly [k: string]: StreamingType | undefined } = { hls: 'hls', hls2: 'hls2', hls4: 'hls4' };

const TITLE_PREFS_KEY = 'kp_title_prefs';
const TITLE_PREFS_MAX = 100;

export class Storage {
  // --- Constants ---

  static readonly QUALITY_OPTIONS: ReadonlyArray<QualityOption> = [
    { id: QualityId.Auto, label: 'Авто (макс.)', maxH: 0 },
    { id: QualityId.UHD, label: '4K (2160p)', maxH: 2160 },
    { id: QualityId.FullHD, label: 'Full HD (1080p)', maxH: 1080 },
    { id: QualityId.HD, label: 'HD (720p)', maxH: 720 },
    { id: QualityId.SD, label: 'SD (480p)', maxH: 480 }
  ];

  static readonly DEFAULT_SUB_SIZE = 46;
  static readonly SUB_SIZE_STEP = 6;
  static readonly SUB_SIZE_MIN = 22;
  static readonly SUB_SIZE_MAX = 82;

  static readonly ALL_PROXY_CATEGORIES = ALL_CATS;

  static readonly START_PAGE_OPTIONS: ReadonlyArray<StartPageOption> = [
    { id: 'watching',  label: 'Я смотрю' },
    { id: 'novelties', label: 'Новинки' },
    { id: 'bookmarks', label: 'Закладки' },
    { id: 'history',   label: 'История' },
    { id: 'tv',        label: 'ТВ' }
  ];

  // --- Device ID ---

  getDeviceId = (): string => {
    const existing = localStorage.getItem(KEYS.DEVICE_ID);
    if (existing) return existing;
    const id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
    localStorage.setItem(KEYS.DEVICE_ID, id);
    return id;
  };

  // --- Auth tokens ---

  getAccessToken = (): string | null => localStorage.getItem(KEYS.ACCESS_TOKEN);

  getRefreshToken = (): string | null => localStorage.getItem(KEYS.REFRESH_TOKEN);

  saveTokens = (accessToken: string, refreshToken: string, expiresIn: number): void => {
    localStorage.setItem(KEYS.ACCESS_TOKEN, accessToken);
    localStorage.setItem(KEYS.REFRESH_TOKEN, refreshToken);
    localStorage.setItem(KEYS.TOKEN_EXPIRES, String(Date.now() + expiresIn * 1000));
  };

  isTokenExpired = (): boolean => {
    const expires = localStorage.getItem(KEYS.TOKEN_EXPIRES);
    if (!expires) return true;
    return Date.now() > parseInt(expires, 10);
  };

  clearTokens = (): void => {
    localStorage.removeItem(KEYS.ACCESS_TOKEN);
    localStorage.removeItem(KEYS.REFRESH_TOKEN);
    localStorage.removeItem(KEYS.TOKEN_EXPIRES);
  };

  // --- Quality ---

  getDefaultQuality = (): number => {
    const val = localStorage.getItem(KEYS.DEFAULT_QUALITY);
    if (val !== null) return parseInt(val, 10) || 0;
    return -1;
  };

  setDefaultQuality = (id: number): void => {
    localStorage.setItem(KEYS.DEFAULT_QUALITY, String(id));
  };

  // --- Subtitle size ---

  getSubSize = (): number => {
    const val = localStorage.getItem(KEYS.SUB_SIZE);
    return val !== null ? (parseInt(val, 10) || Storage.DEFAULT_SUB_SIZE) : Storage.DEFAULT_SUB_SIZE;
  };

  setSubSize = (size: number): void => {
    localStorage.setItem(KEYS.SUB_SIZE, String(size));
  };

  // --- Streaming type ---

  getStreamingType = (): string => {
    const val = localStorage.getItem(KEYS.STREAMING_TYPE) || 'hls4';
    let code = STREAMING_TYPES[val];
    if (!code) {
      code = 'hls4';
      localStorage.setItem(KEYS.STREAMING_TYPE, code);
    }
    return code;
  };

  setStreamingType = (type: string): void => {
    localStorage.setItem(KEYS.STREAMING_TYPE, type);
  };

  // --- Per-title playback preferences (LRU, max 100) ---

  getTitlePrefs = (itemId: number): TitlePrefs | null => {
    const arr = this.loadTitlePrefsArr();
    for (let i = 0; i < arr.length; i++) {
      if (arr[i].id === itemId) return arr[i];
    }
    return null;
  };

  saveTitlePrefs = (prefs: TitlePrefs): void => {
    const arr = this.loadTitlePrefsArr();
    const filtered = arr.filter((p) => p.id !== prefs.id);
    filtered.unshift(prefs);
    if (filtered.length > TITLE_PREFS_MAX) filtered.length = TITLE_PREFS_MAX;
    localStorage.setItem(TITLE_PREFS_KEY, JSON.stringify(filtered));
  };

  private loadTitlePrefsArr = (): TitlePrefs[] => {
    try {
      const raw = localStorage.getItem(TITLE_PREFS_KEY);
      if (raw) return JSON.parse(raw) as TitlePrefs[];
    } catch (_) { /* ignore */ }
    return [];
  };

  // --- Proxy ---

  // Migrate legacy (PROXY_ALL / PROXY_TV / PROXY_POSTERS) keys into the new
  // PROXY_CATS bitmask. Runs once: once PROXY_CATS exists, the legacy keys
  // are removed and subsequent reads skip this block.
  private migrateProxyKeys = (): void => {
    if (localStorage.getItem(KEYS.PROXY_CATS) !== null) return;
    const all = localStorage.getItem(LEGACY_PROXY_KEYS.ALL) === '1';
    const tv = localStorage.getItem(LEGACY_PROXY_KEYS.TV) === '1';
    const posters = localStorage.getItem(LEGACY_PROXY_KEYS.POSTERS);
    // subtitles always on by default — direct CDN fetch fails on CORS
    let mask: number = ProxyCategory.Subtitles;
    if (posters === null || posters === '1') mask |= ProxyCategory.Posters;
    if (tv || all) mask |= ProxyCategory.Tv;
    if (all) mask |= ProxyCategory.Media;
    localStorage.setItem(KEYS.PROXY_CATS, String(mask));
    localStorage.removeItem(LEGACY_PROXY_KEYS.ALL);
    localStorage.removeItem(LEGACY_PROXY_KEYS.TV);
    localStorage.removeItem(LEGACY_PROXY_KEYS.POSTERS);
  };

  private readProxyMask = (): number => {
    this.migrateProxyKeys();
    const raw = localStorage.getItem(KEYS.PROXY_CATS);
    if (raw === null) return DEFAULT_CATS;
    const n = parseInt(raw, 10);
    return isNaN(n) ? DEFAULT_CATS : n;
  };

  private writeProxyMask = (mask: number): void => {
    localStorage.setItem(KEYS.PROXY_CATS, String(mask));
  };

  isProxyEnabled = (cat: ProxyCategory): boolean => (this.readProxyMask() & cat) !== 0;

  setProxyEnabled = (cat: ProxyCategory, enabled: boolean): void => {
    const mask = this.readProxyMask();
    this.writeProxyMask(enabled ? (mask | cat) : (mask & ~cat));
  };

  downgradeProxyForNonVip = (): void => {
    const mask = this.readProxyMask();
    const next = mask & ~VIP_ONLY_CATS;
    if (next !== mask) this.writeProxyMask(next);
  };

  isProxyCategoryVipOnly = (cat: ProxyCategory): boolean => (VIP_ONLY_CATS & cat) !== 0;

  getAvailableProxyCategories = (isVip: boolean): ReadonlyArray<ProxyCategory> => {
    if (isVip) return ALL_CATS;
    const result: ProxyCategory[] = [];
    for (let i = 0; i < ALL_CATS.length; i++) {
      if (!this.isProxyCategoryVipOnly(ALL_CATS[i])) result.push(ALL_CATS[i]);
    }
    return result;
  };

  // --- Start page ---

  getStartPage = (): RouteName => {
    const val = localStorage.getItem(KEYS.START_PAGE);
    for (let i = 0; i < Storage.START_PAGE_OPTIONS.length; i++) {
      if (Storage.START_PAGE_OPTIONS[i].id === val) return val as RouteName;
    }
    return 'watching';
  };

  setStartPage = (id: RouteName): void => {
    localStorage.setItem(KEYS.START_PAGE, id);
  };

  // --- Legacy HLS toggle ---
  // Default is `true` — we ship hls.js 0.14.x as the safe baseline. Modern
  // hls.js 1.5+ is opt-in via the "Старый телевизор" setting. Inline loader
  // in index.html reads this key directly from localStorage (it runs before
  // any TS code), so the key name must stay in sync.

  isLegacyHls = (): boolean => {
    const val = localStorage.getItem(KEYS.LEGACY_HLS);
    return val === null || val === '1';
  };

  setLegacyHls = (enabled: boolean): void => {
    localStorage.setItem(KEYS.LEGACY_HLS, enabled ? '1' : '0');
  };

  isLegacyHlsForced = (): boolean =>
    localStorage.getItem(KEYS.LEGACY_HLS_FORCED) === '1';

  // --- Cached device settings (from /v1/device/{id}/settings) ---
  // Flat { key: effectiveValue } map derived from the server response so any
  // non-UI code (player, media layer) can read individual flags synchronously
  // without re-fetching. VIP / proxy are a separate concern — they come from
  // /v1/user, not device settings.

  private readDeviceSettings = (): DeviceSettingsMap => {
    try {
      const raw = localStorage.getItem(KEYS.DEVICE_SETTINGS);
      if (raw) return JSON.parse(raw) as DeviceSettingsMap;
    } catch (_) { /* malformed — fall through */ }
    return {};
  };

  private writeDeviceSettings = (map: DeviceSettingsMap): void => {
    try {
      localStorage.setItem(KEYS.DEVICE_SETTINGS, JSON.stringify(map));
    } catch (_) { /* quota — ignore */ }
  };

  setDeviceSettingsFromApi = (settings: Record<string, DeviceSetting>): void => {
    this.writeDeviceSettings(flattenDeviceSettings(settings));
  };

  setDeviceSetting = (key: string, value: DeviceSettingValue): void => {
    const map = this.readDeviceSettings();
    map[key] = value;
    this.writeDeviceSettings(map);
  };

  getDeviceSetting = (key: string): DeviceSettingValue | undefined => this.readDeviceSettings()[key];

  getDeviceSettingBool = (key: string): boolean => this.readDeviceSettings()[key] === true;

  // --- URL rewriting ---

  // Wraps `url` in our backend's /proxy passthrough when the given category
  // is enabled; otherwise returns the original URL unchanged. Callers pass
  // the category and should NOT re-check isProxyEnabled — that's the whole
  // point of this helper.
  getRewrittenUrl = (cat: ProxyCategory, url: string): string => {
    if (!url || !this.isProxyEnabled(cat)) return url;
    return '/proxy?url=' + encodeURIComponent(url);
  };

  proxyPosterUrl = (url: string): string => this.getRewrittenUrl(ProxyCategory.Posters, url);
}

export const storage = new Storage();
