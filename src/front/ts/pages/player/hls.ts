import $ from 'jquery';
import { getApiBase } from '../../api/client';
import { getAccessToken } from '../../utils/storage';

export function getBaseUrl(url: string): string {
  var i = url.indexOf('?');
  var clean = i >= 0 ? url.substring(0, i) : url;
  var last = clean.lastIndexOf('/');
  return last >= 0 ? clean.substring(0, last + 1) : '';
}

export function makeUrlsAbsolute(manifest: string, baseUrl: string): string {
  if (!baseUrl) return manifest;
  var lines = manifest.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
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
  var target = 'a' + audioIndex;
  return manifest.replace(/(index-v\d+)a\d+(\.m3u8)/g, '$1' + target + '$2')
    .replace(/(iframes-v\d+)a\d+(\.m3u8)/g, '$1' + target + '$2')
    .replace(/(seg-\d+-v\d+)-a\d+(\.ts)/g, '$1-' + target + '$2');
}

export function getRewrittenHlsUrl(url: string, audioIndex: number): string {
  // Use window.location.origin when page is served from our backend (Android APK or proxy mode).
  // getApiBase() returns '' in proxy mode (relative URL) and absolute API_BASE otherwise.
  var base = getApiBase() === '' ? window.location.origin : '';
  var token = getAccessToken() || '';
  return base + '/hls/rewrite?url=' + encodeURIComponent(url) + '&audio=' + audioIndex +
    (token ? '&access_token=' + encodeURIComponent(token) : '');
}

export function isBackendRewriteAvailable(): boolean {
  return getApiBase() === '';
}

export function fetchRewrittenHls(url: string, audioIndex: number, cb: (blobUrl: string | null) => void): void {
  $.ajax({
    url: url,
    dataType: 'text',
    success: function (data: string) {
      var baseUrl = getBaseUrl(url);
      var rewritten = rewriteHlsManifest(data, audioIndex);
      rewritten = makeUrlsAbsolute(rewritten, baseUrl);
      var blob = new Blob([rewritten], { type: 'application/vnd.apple.mpegurl' });
      cb(URL.createObjectURL(blob));
    },
    error: function () {
      cb(null);
    }
  });
}
