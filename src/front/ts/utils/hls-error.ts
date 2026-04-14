import { Logger } from './log';
import { platform } from './platform';
import { extractHostname } from './url';
import { tplErrorScreen } from '../pages/player/error-template';

export interface HlsErrorData {
  fatal: boolean;
  type: string;
  details: string;
  response?: { code: number };
  frag?: { url?: string };
  url?: string;
  context?: { url?: string };
}

const getErrorMessage = (type: string, details: string): string => {
  if (type === 'networkError') {
    if (details.indexOf('TimeOut') >= 0) return 'Таймаут загрузки видео';
    return 'Ошибка сети при загрузке видео';
  }
  if (type === 'mediaError') return 'Ошибка декодирования видео';
  return 'Ошибка воспроизведения';
};

export const getFailedUrl = (data: HlsErrorData): string =>
  data.frag?.url || data.url || data.context?.url || '';

export const formatHlsErrorDebug = (data: HlsErrorData): string =>
  'type=' + data.type + ' details=' + data.details +
  (data.response ? ' status=' + data.response.code : '');

export const showHlsError = (
  log: Logger,
  $root: JQuery,
  data: HlsErrorData,
  prefix: 'player' | 'tv-player',
): void => {
  const failedUrl = getFailedUrl(data);
  const domain = extractHostname(failedUrl);
  const message = getErrorMessage(data.type, data.details);
  const debug = formatHlsErrorDebug(data);

  const devInfo = platform.getDeviceInfo();
  log.error('playbackError {message} {domain} {debug}', {
    message, domain, debug,
    ua: navigator.userAgent, hw: devInfo.hardware, sw: devInfo.software,
  });

  const debugLines: string[] = [];
  if (domain) debugLines.push(domain);
  debugLines.push(debug);
  debugLines.push(navigator.userAgent);
  $root.html(tplErrorScreen({ prefix, msg: message, debugLines }));
};
