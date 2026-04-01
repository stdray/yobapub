import { isProxyAll, getStreamingType } from './storage';
import { isLegacyTizen } from './platform';
import { Logger } from './log';

export const buildBaseHlsConfig = (): Record<string, number> => {
  const cfg: Record<string, number> = {
    fragLoadingMaxRetry: 3,
    manifestLoadingMaxRetry: 2,
    levelLoadingMaxRetry: 2
  };
  if (isLegacyTizen()) {
    cfg.maxBufferLength = 10;
    cfg.maxMaxBufferLength = 30;
  }
  return cfg;
};

export const applyHlsProxy = (): boolean => isProxyAll();

export const logPlaybackStart = (log: Logger, url: string, extra?: Record<string, unknown>): void => {
  log.info('playback url={url} ver={ver} ua={ua} proxy={proxy} streaming={streaming}', {
    url: url.substring(0, 120),
    ver: __APP_VERSION__,
    ua: navigator.userAgent,
    proxy: isProxyAll(),
    streaming: getStreamingType(),
    ...extra,
  });
};
