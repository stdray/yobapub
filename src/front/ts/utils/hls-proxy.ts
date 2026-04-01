import { isProxyAll, getStreamingType } from './storage';
import { Logger } from './log';

const proxyXhrSetup = (xhr: XMLHttpRequest, url: string): void => {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const isManifest = /\.m3u8(\?|$)/.test(url);
    const newUrl = isManifest
      ? '/hls/rewrite?audio=0&url=' + encodeURIComponent(url)
      : '/hls/proxy?url=' + encodeURIComponent(url);
    xhr.open('GET', newUrl, true);
  }
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
