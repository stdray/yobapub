import { RouteName } from '../types/app';

const KEYS = {
  ACCESS_TOKEN: 'kp_access_token',
  REFRESH_TOKEN: 'kp_refresh_token',
  TOKEN_EXPIRES: 'kp_token_expires',
  DEFAULT_QUALITY: 'kp_default_quality',
  SUB_SIZE: 'kp_sub_size',
  STREAMING_TYPE: 'kp_streaming_type',
  PROXY_ALL: 'kp_proxy_all',
  PROXY_POSTERS: 'kp_proxy_posters',
  START_PAGE: 'kp_start_page',
  DEVICE_ID: 'kp_device_id'
};

export function getDeviceId(): string {
  let id = localStorage.getItem(KEYS.DEVICE_ID);
  if (id) return id;
  id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
  localStorage.setItem(KEYS.DEVICE_ID, id);
  return id;
}

export function getAccessToken(): string | null {
  return localStorage.getItem(KEYS.ACCESS_TOKEN);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(KEYS.REFRESH_TOKEN);
}

export function saveTokens(accessToken: string, refreshToken: string, expiresIn: number): void {
  localStorage.setItem(KEYS.ACCESS_TOKEN, accessToken);
  localStorage.setItem(KEYS.REFRESH_TOKEN, refreshToken);
  localStorage.setItem(KEYS.TOKEN_EXPIRES, String(Date.now() + expiresIn * 1000));
}

export function isTokenExpired(): boolean {
  const expires = localStorage.getItem(KEYS.TOKEN_EXPIRES);
  if (!expires) return true;
  return Date.now() > parseInt(expires, 10);
}

export function clearTokens(): void {
  localStorage.removeItem(KEYS.ACCESS_TOKEN);
  localStorage.removeItem(KEYS.REFRESH_TOKEN);
  localStorage.removeItem(KEYS.TOKEN_EXPIRES);
}

export var QUALITY_OPTIONS = [
  { id: 0, label: 'Авто (макс.)', maxH: 0 },
  { id: 1, label: '4K (2160p)', maxH: 2160 },
  { id: 2, label: 'Full HD (1080p)', maxH: 1080 },
  { id: 3, label: 'HD (720p)', maxH: 720 },
  { id: 4, label: 'SD (480p)', maxH: 480 }
];

export function getDefaultQuality(): number {
  const val = localStorage.getItem(KEYS.DEFAULT_QUALITY);
  if (val !== null) return parseInt(val, 10) || 0;
  return -1;
}

export function setDefaultQuality(id: number): void {
  localStorage.setItem(KEYS.DEFAULT_QUALITY, String(id));
}

export var DEFAULT_SUB_SIZE = 46;
export var SUB_SIZE_STEP = 6;
export var SUB_SIZE_MIN = 22;
export var SUB_SIZE_MAX = 82;

export function getSubSize(): number {
  const val = localStorage.getItem(KEYS.SUB_SIZE);
  return val !== null ? (parseInt(val, 10) || DEFAULT_SUB_SIZE) : DEFAULT_SUB_SIZE;
}

export function setSubSize(size: number): void {
  localStorage.setItem(KEYS.SUB_SIZE, String(size));
}

const STREAMING_TYPES: Record<string, string> = { 'hls': 'hls', 'hls2': 'hls2', 'hls4': 'hls4' };

export function getStreamingType(): string {
  const val = localStorage.getItem(KEYS.STREAMING_TYPE) || 'hls4';
  let code = STREAMING_TYPES[val];
  if (!code) {
    code = 'hls4';
    localStorage.setItem(KEYS.STREAMING_TYPE, code);
  }
  return code;
}

export function setStreamingType(type: string): void {
  localStorage.setItem(KEYS.STREAMING_TYPE, type);
}

// --- Per-title playback preferences (LRU, max 100) ---

const TITLE_PREFS_KEY = 'kp_title_prefs';
const TITLE_PREFS_MAX = 100;

export interface TitlePrefs {
  id: number;
  quality?: string;
  audioLang?: string;
  audioAuthorId?: number;
  subLang?: string;
}

function loadTitlePrefsArr(): TitlePrefs[] {
  try {
    const raw = localStorage.getItem(TITLE_PREFS_KEY);
    if (raw) return JSON.parse(raw) as TitlePrefs[];
  } catch (e) { /* ignore */ }
  return [];
}

function saveTitlePrefsArr(arr: TitlePrefs[]): void {
  localStorage.setItem(TITLE_PREFS_KEY, JSON.stringify(arr));
}

export function getTitlePrefs(itemId: number): TitlePrefs | null {
  const arr = loadTitlePrefsArr();
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].id === itemId) return arr[i];
  }
  return null;
}

export function saveTitlePrefs(prefs: TitlePrefs): void {
  const arr = loadTitlePrefsArr();
  const filtered: TitlePrefs[] = [];
  for (var i = 0; i < arr.length; i++) {
    if (arr[i].id !== prefs.id) filtered.push(arr[i]);
  }
  filtered.unshift(prefs);
  if (filtered.length > TITLE_PREFS_MAX) filtered.length = TITLE_PREFS_MAX;
  saveTitlePrefsArr(filtered);
}

// --- Proxy ---

export function isProxyAll(): boolean {
  return localStorage.getItem(KEYS.PROXY_ALL) === '1';
}

export function setProxyAll(on: boolean): void {
  if (on) {
    localStorage.setItem(KEYS.PROXY_ALL, '1');
  } else {
    localStorage.removeItem(KEYS.PROXY_ALL);
  }
}

export var START_PAGE_OPTIONS: Array<{ id: RouteName; label: string }> = [
  { id: 'watching',  label: 'Я смотрю' },
  { id: 'novelties', label: 'Новинки' }
];

export function getStartPage(): RouteName {
  const val = localStorage.getItem(KEYS.START_PAGE);
  for (var i = 0; i < START_PAGE_OPTIONS.length; i++) {
    if (START_PAGE_OPTIONS[i].id === val) return val as RouteName;
  }
  return 'watching';
}

export function setStartPage(id: RouteName): void {
  localStorage.setItem(KEYS.START_PAGE, id);
}

export function isProxyPosters(): boolean {
  const val = localStorage.getItem(KEYS.PROXY_POSTERS);
  return val === null || val === '1';
}

export function setProxyPosters(on: boolean): void {
  localStorage.setItem(KEYS.PROXY_POSTERS, on ? '1' : '0');
}

function rewriteUrl(url: string): string {
  return '/proxy?url=' + encodeURIComponent(url);
}

export function proxyPosterUrl(url: string): string {
  if (!isProxyPosters() || !url) return url;
  return rewriteUrl(url);
}

export function proxyUrl(url: string): string {
  if (!isProxyAll() || !url) return url;
  return rewriteUrl(url);
}
