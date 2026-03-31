import { getAccessToken } from '../../utils/storage';

export function getBaseUrl(url: string): string {
  const i = url.indexOf('?');
  const clean = i >= 0 ? url.substring(0, i) : url;
  const last = clean.lastIndexOf('/');
  return last >= 0 ? clean.substring(0, last + 1) : '';
}

export function makeUrlsAbsolute(manifest: string, baseUrl: string): string {
  if (!baseUrl) return manifest;
  const lines = manifest.split('\n');
  for (var i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line && line.charAt(0) !== '#' && line.indexOf('://') === -1) {
      lines[i] = baseUrl + line;
    }
    if (line.indexOf('URI="') >= 0) {
      lines[i] = lines[i].replace(/URI="([^"]+)"/g, function (_m: string, uri: string) {
        if (uri.indexOf('://') === -1) return 'URI="' + baseUrl + uri + '"';
        return _m;
      });
    }
  }
  return lines.join('\n');
}

export function rewriteHlsManifest(manifest: string, audioIndex: number): string {
  const target = 'a' + audioIndex;
  // hls2: muxed audio in segment names
  let result = manifest
    .replace(/(index-v\d+)a\d+(\.m3u8)/g, '$1' + target + '$2')
    .replace(/(iframes-v\d+)a\d+(\.m3u8)/g, '$1' + target + '$2')
    .replace(/(seg-\d+-v\d+)-a\d+(\.ts)/g, '$1-' + target + '$2');
  // hls4: master playlist with #EXT-X-MEDIA audio tracks — set DEFAULT=YES for target track
  const audioRe = new RegExp('/index-a' + audioIndex + '\\.m3u8');
  result = result.replace(/(#EXT-X-MEDIA:[^\n]*TYPE=AUDIO[^\n]*)/g, function (line) {
    const isTarget = audioRe.test(line);
    return line.replace(/DEFAULT=(YES|NO)/g, isTarget ? 'DEFAULT=YES' : 'DEFAULT=NO');
  });
  return result;
}

export function getRewrittenHlsUrl(url: string, audioIndex: number): string {
  const token = getAccessToken() || '';
  return window.location.origin + '/hls/rewrite?url=' + encodeURIComponent(url) + '&audio=' + audioIndex +
    (token ? '&access_token=' + encodeURIComponent(token) : '');
}




