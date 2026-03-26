var KEYS = {
  ACCESS_TOKEN: 'kp_access_token',
  REFRESH_TOKEN: 'kp_refresh_token',
  TOKEN_EXPIRES: 'kp_token_expires',
  DEFAULT_QUALITY: 'kp_default_quality',
  SUB_SIZE: 'kp_sub_size',
  STREAMING_TYPE: 'kp_streaming_type'
};

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
  var expires = localStorage.getItem(KEYS.TOKEN_EXPIRES);
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
  var val = localStorage.getItem(KEYS.DEFAULT_QUALITY);
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
  var val = localStorage.getItem(KEYS.SUB_SIZE);
  return val !== null ? (parseInt(val, 10) || DEFAULT_SUB_SIZE) : DEFAULT_SUB_SIZE;
}

export function setSubSize(size: number): void {
  localStorage.setItem(KEYS.SUB_SIZE, String(size));
}

var STREAMING_TYPES: Record<string, string> = { 'http': 'http', 'hls': 'hls', 'hls2': 'hls2', 'hls4': 'hls4' };

export function getStreamingType(): string {
  var val = localStorage.getItem(KEYS.STREAMING_TYPE) || 'hls4';
  var code = STREAMING_TYPES[val];
  if (!code) {
    code = 'hls4';
    localStorage.setItem(KEYS.STREAMING_TYPE, code);
  }
  return code;
}

export function setStreamingType(type: string): void {
  localStorage.setItem(KEYS.STREAMING_TYPE, type);
}
