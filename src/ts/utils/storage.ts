var KEYS = {
  ACCESS_TOKEN: 'kp_access_token',
  REFRESH_TOKEN: 'kp_refresh_token',
  TOKEN_EXPIRES: 'kp_token_expires',
  DEFAULT_QUALITY: 'kp_default_quality'
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
