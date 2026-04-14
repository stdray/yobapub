import { Logger } from '../../utils/log';

interface CtLogWindow extends Window {
  __ctLog?: (site: string, value: number, prev: number) => void;
}

// Expose a global logging function so patched hls.js source files in node_modules
// (stream-controller, gap-controller, audio-stream-controller) can log every
// `media.currentTime = X` assignment via our backend-bound Logger. Tizen 2.3
// WebKit exposes currentTime as a data property, not an accessor, so we cannot
// intercept assignments via Object.defineProperty — patching the library directly
// is the only viable approach. Remove after the source of startup seeks is found.
export const installCtLogShim = (log: Logger): void => {
  (window as CtLogWindow).__ctLog = (site: string, value: number, prev: number): void => {
    try {
      const stack = ((new Error().stack || '').split('\n').slice(1, 10).join(' | ')).substring(0, 600);
      log.info('ctwrap site={site} value={value} prev={prev} stack={stack}', { site, value, prev, stack });
    } catch (_e) { /* never break playback on log failure */ }
  };
};
