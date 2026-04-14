import { storage, ProxyCategory } from '../../utils/storage';

export const getBaseUrl = (url: string): string => {
  const i = url.indexOf('?');
  const clean = i >= 0 ? url.substring(0, i) : url;
  const last = clean.lastIndexOf('/');
  return last >= 0 ? clean.substring(0, last + 1) : '';
};

export const makeUrlsAbsolute = (manifest: string, baseUrl: string): string => {
  if (!baseUrl) return manifest;
  const lines = manifest.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && line.charAt(0) !== '#' && line.indexOf('://') === -1) {
      lines[i] = baseUrl + line;
    }
    if (line.indexOf('URI="') >= 0) {
      lines[i] = lines[i].replace(/URI="([^"]+)"/g, (_m: string, uri: string) => {
        if (uri.indexOf('://') === -1) return 'URI="' + baseUrl + uri + '"';
        return _m;
      });
    }
  }
  return lines.join('\n');
};

export const rewriteHlsManifest = (manifest: string, audioIndex: number): string => {
  const target = 'a' + audioIndex;
  // hls2: muxed audio in segment names
  let result = manifest
    .replace(/(index-v\d+)a\d+(\.m3u8)/g, '$1' + target + '$2')
    .replace(/(iframes-v\d+)a\d+(\.m3u8)/g, '$1' + target + '$2')
    .replace(/(seg-\d+-v\d+)-a\d+(\.ts)/g, '$1-' + target + '$2');
  // hls4: master playlist with #EXT-X-MEDIA audio tracks — set DEFAULT=YES for target track
  const audioRe = new RegExp('/index-a' + audioIndex + '\\.m3u8');
  result = result.replace(/(#EXT-X-MEDIA:[^\n]*TYPE=AUDIO[^\n]*)/g, (line) => {
    const isTarget = audioRe.test(line);
    return line.replace(/DEFAULT=(YES|NO)/g, isTarget ? 'DEFAULT=YES' : 'DEFAULT=NO');
  });
  return result;
};

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
