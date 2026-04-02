import { RouteName } from '../types/app';

export type ProxyMode = 'none' | 'posters' | 'posters-tv' | 'all';

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
}

interface QualityOption {
  readonly id: number;
  readonly label: string;
  readonly maxH: number;
}

interface ProxyModeOption {
  readonly id: ProxyMode;
  readonly label: string;
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
  PROXY_ALL: 'kp_proxy_all',
  PROXY_POSTERS: 'kp_proxy_posters',
  PROXY_TV: 'kp_proxy_tv',
  START_PAGE: 'kp_start_page',
  DEVICE_ID: 'kp_device_id'
} as const;

const STREAMING_TYPES: Readonly<Record<string, string>> = { hls: 'hls', hls2: 'hls2', hls4: 'hls4' };

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

  static readonly PROXY_MODE_OPTIONS: ReadonlyArray<ProxyModeOption> = [
    { id: 'none', label: 'Нет' },
    { id: 'posters', label: 'Постеры' },
    { id: 'posters-tv', label: 'Постеры && ТВ' },
    { id: 'all', label: 'Всё' },
  ];

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

  getProxyMode = (): ProxyMode => {
    if (localStorage.getItem(KEYS.PROXY_ALL) === '1') return 'all';
    if (localStorage.getItem(KEYS.PROXY_TV) === '1') return 'posters-tv';
    const posters = localStorage.getItem(KEYS.PROXY_POSTERS);
    if (posters === null || posters === '1') return 'posters';
    return 'none';
  };

  setProxyMode = (mode: ProxyMode): void => {
    localStorage.setItem(KEYS.PROXY_POSTERS, mode === 'posters' || mode === 'posters-tv' || mode === 'all' ? '1' : '0');
    if (mode === 'all') {
      localStorage.setItem(KEYS.PROXY_ALL, '1');
    } else {
      localStorage.removeItem(KEYS.PROXY_ALL);
    }
    if (mode === 'posters-tv') {
      localStorage.setItem(KEYS.PROXY_TV, '1');
    } else {
      localStorage.removeItem(KEYS.PROXY_TV);
    }
  };

  isProxyTv = (): boolean =>
    localStorage.getItem(KEYS.PROXY_TV) === '1' || localStorage.getItem(KEYS.PROXY_ALL) === '1';

  isProxyAll = (): boolean => localStorage.getItem(KEYS.PROXY_ALL) === '1';

  isVipProxyMode = (): boolean => {
    const mode = this.getProxyMode();
    return mode === 'all' || mode === 'posters-tv';
  };

  downgradeProxyForNonVip = (): void => {
    if (this.isVipProxyMode()) this.setProxyMode('posters');
  };

  getAvailableProxyModes = (isVip: boolean): ReadonlyArray<ProxyModeOption> =>
    isVip ? Storage.PROXY_MODE_OPTIONS : Storage.PROXY_MODE_OPTIONS.filter((o) => o.id !== 'posters-tv' && o.id !== 'all');

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

  // --- URL rewriting ---

  proxyPosterUrl = (url: string): string => {
    if (!url) return url;
    const val = localStorage.getItem(KEYS.PROXY_POSTERS);
    if (val !== null && val !== '1') return url;
    return '/proxy?url=' + encodeURIComponent(url);
  };

  proxyUrl = (url: string): string => {
    if (!this.isProxyAll() || !url) return url;
    return '/proxy?url=' + encodeURIComponent(url);
  };
}

export const storage = new Storage();
