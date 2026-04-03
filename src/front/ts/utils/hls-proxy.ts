import { storage } from './storage';
import { platform } from './platform';
import { Logger } from './log';

interface HlsBufferLimits {
  readonly maxBufferLength: number;
  readonly maxMaxBufferLength: number;
}

export const getBufferLimits = (tizenVersion: number): HlsBufferLimits => {
  if (tizenVersion > 0 && tizenVersion < 3) {
    // Tizen 2.3: very limited memory, keep buffer small
    return { maxBufferLength: 10, maxMaxBufferLength: 30 };
  }
  if (tizenVersion >= 3 && tizenVersion < 5) {
    // Tizen 3.0–4.0: moderate memory
    return { maxBufferLength: 15, maxMaxBufferLength: 60 };
  }
  if (tizenVersion >= 5) {
    // Tizen 5.0+: more capable but SourceBuffer has hard memory limits
    return { maxBufferLength: 15, maxMaxBufferLength: 45 };
  }
  // Non-Tizen (browser, Android): reasonable defaults, not hls.js's 600s
  return { maxBufferLength: 30, maxMaxBufferLength: 120 };
};

export const buildBaseHlsConfig = (): Record<string, number> => {
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
