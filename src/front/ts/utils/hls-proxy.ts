import Hls from 'hls.js';
import { storage, ProxyCategory } from './storage';
import { platform } from './platform';
import { Logger } from './log';
import { formatAppVersion } from './format';

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

export interface PlaybackOpts {
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
