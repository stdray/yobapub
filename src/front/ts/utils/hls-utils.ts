import Hls from 'hls.js';
import { storage, ProxyCategory } from './storage';
import { platform } from './platform';
import { Logger } from './log';
import { extractHostname } from './url';
import { formatAppVersion } from './format';
import { VideoFile } from '../types/api';
import { tplErrorScreen } from '../pages/player/template';
import { HlsError } from '../pages/player/hls-adapter';

// ── Config / setup ────────────────────────────────────────────────

export type HlsConfig = Partial<Hls.Config>;

interface HlsBufferLimits {
  readonly maxBufferLength: number;
  readonly maxMaxBufferLength: number;
}

const getBufferLimits = (tizenVersion: number): HlsBufferLimits => {
  if (tizenVersion > 0 && tizenVersion < 3) {
    return { maxBufferLength: 10, maxMaxBufferLength: 30 };
  }
  if (tizenVersion >= 3) {
    return { maxBufferLength: 10, maxMaxBufferLength: 30 };
  }
  // Non-Tizen (browser, Android): reasonable defaults, not hls.js's 600s
  return { maxBufferLength: 30, maxMaxBufferLength: 90 };
};

export const buildBaseHlsConfig = (): HlsConfig => {
  const limits = getBufferLimits(platform.getTizenVersion());
  return {
    fragLoadingMaxRetry: 3,
    manifestLoadingMaxRetry: 2,
    levelLoadingMaxRetry: 2,
    maxBufferLength: limits.maxBufferLength,
    maxMaxBufferLength: limits.maxMaxBufferLength,
  };
};

export const pickHlsUrl = (f: VideoFile): string => {
  const hls4 = (f.urls && f.urls.hls4) || (f.url && f.url.hls4) || '';
  const hls2 = (f.urls && f.urls.hls2) || (f.url && f.url.hls2) || '';
  if (platform.isLegacyTizen()) return hls2;
  const sp = storage.getStreamingType();
  if (sp === 'hls4') return hls4;
  if (sp === 'hls2') return hls2;
  return hls4 || hls2;
};

interface PlaybackOpts {
  readonly startPosition?: number;
  readonly quality?: number;
  readonly audio?: number;
  readonly sub?: number;
}

export const logPlaybackStart = (log: Logger, url: string, opts?: PlaybackOpts): void => {
  log.info('app ver={ver}', { ver: formatAppVersion() });
  const di = platform.getDeviceInfo();
  log.info('device hw={hw} sw={sw} tizen={tizen} ua={ua}', {
    hw: di.hardware,
    sw: di.software,
    tizen: platform.getTizenVersion(),
    ua: navigator.userAgent,
  });
  log.info('playback url={url}', { url });
  log.info('playback opts proxy={proxy} streaming={streaming} startPos={startPos} quality={quality} audio={audio} sub={sub}', {
    proxy: storage.isProxyEnabled(ProxyCategory.Media),
    streaming: storage.getStreamingType(),
    startPos: opts && opts.startPosition !== undefined ? opts.startPosition : null,
    quality: opts && opts.quality !== undefined ? opts.quality : null,
    audio: opts && opts.audio !== undefined ? opts.audio : null,
    sub: opts && opts.sub !== undefined ? opts.sub : null,
  });
};

// ── Proxy URL rewriting ───────────────────────────────────────────

// Always routes through /hls/rewrite (the backend rewrites m3u8 to switch
// audio tracks). The backend's own segment proxying is toggled by the given
// category; callers just pass the category and don't check the flag.
export const getRewrittenHlsUrl = (url: string, audioIndex: number, cat: ProxyCategory): string => {
  const token = storage.getAccessToken() || '';
  return '/hls/rewrite?url=' + encodeURIComponent(url) + '&audio=' + audioIndex +
    (storage.isProxyEnabled(cat) ? '&proxy=true' : '') +
    (token ? '&access_token=' + encodeURIComponent(token) : '');
};

// For consumers where /hls/rewrite is only needed when proxying is on (e.g.
// TV channels have a single audio track, so audio-switching rewrites are
// irrelevant). Returns the original URL if the category is off.
export const getOptionalRewrittenHlsUrl = (url: string, audioIndex: number, cat: ProxyCategory): string => {
  if (!storage.isProxyEnabled(cat)) return url;
  return getRewrittenHlsUrl(url, audioIndex, cat);
};

// ── Error display ─────────────────────────────────────────────────

const getErrorMessage = (type: string, details: string): string => {
  if (type === 'networkError') {
    if (details.indexOf('TimeOut') >= 0) return 'Таймаут загрузки видео';
    return 'Ошибка сети при загрузке видео';
  }
  if (type === 'mediaError') return 'Ошибка декодирования видео';
  return 'Ошибка воспроизведения';
};

const formatHlsErrorDebug = (err: HlsError): string =>
  'type=' + err.type + ' details=' + err.details +
  (err.httpStatus !== null ? ' status=' + err.httpStatus : '');

export const showHlsError = (
  log: Logger,
  $root: JQuery,
  err: HlsError,
  prefix: 'player' | 'tv-player',
): void => {
  const domain = extractHostname(err.url || '');
  const message = getErrorMessage(err.type, err.details);
  const debug = formatHlsErrorDebug(err);

  const devInfo = platform.getDeviceInfo();
  log.error('playbackError {message} {domain} {debug}', {
    message, domain, debug,
    ua: navigator.userAgent, hw: devInfo.hardware, sw: devInfo.software,
  });

  const debugLines: string[] = [];
  if (domain) debugLines.push(domain);
  debugLines.push(debug);
  debugLines.push(navigator.userAgent);
  $root.html(tplErrorScreen({ prefix, msg: message, debugLines }));
};
