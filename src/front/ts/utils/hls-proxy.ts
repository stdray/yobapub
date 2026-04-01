import { isProxyAll, getStreamingType } from './storage';
import { isLegacyTizen } from './platform';
import { Logger } from './log';

const proxyLog = new Logger('hls-proxy');

const proxyXhrSetup = (xhr: XMLHttpRequest, url: string): void => {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const isManifest = /\.m3u8(\?|$)/.test(url);
    const newUrl = isManifest
      ? '/hls/rewrite?audio=0&url=' + encodeURIComponent(url)
      : '/hls/proxy?url=' + encodeURIComponent(url);
    proxyLog.debug('xhrSetup rewrite {type} {url}', {
      type: isManifest ? 'manifest' : 'segment',
      url: url.substring(0, 120),
      newUrl: newUrl.substring(0, 120)
    });
    xhr.open('GET', newUrl, true);
  } else {
    proxyLog.debug('xhrSetup passthrough {url}', { url: url.substring(0, 120) });
  }
};

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

export const applyHlsProxy = (config: Record<string, unknown>): boolean => {
  if (!isProxyAll()) return false;
  config.xhrSetup = proxyXhrSetup;
  return true;
};

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
