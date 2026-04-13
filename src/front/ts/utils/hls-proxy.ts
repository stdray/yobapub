import Hls from 'hls.js';
import { storage } from './storage';
import { platform } from './platform';
import { Logger } from './log';

export type HlsConfig = Partial<Hls.Config>;

interface HlsBufferLimits {
  readonly maxBufferLength: number;
  readonly maxMaxBufferLength: number;
}

export const getBufferLimits = (tizenVersion: number): HlsBufferLimits => {
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

export const logPlaybackStart = (log: Logger, url: string, extra?: Record<string, unknown>): void => {
  log.info('playback url={url} ver={ver} ua={ua} proxy={proxy} streaming={streaming}', {
    url: url.substring(0, 120),
    ver: __APP_VERSION__,
    ua: navigator.userAgent,
    proxy: storage.isProxyAll(),
    streaming: storage.getStreamingType(),
    ...extra,
  });
};
