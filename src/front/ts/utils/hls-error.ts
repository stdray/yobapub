import { Logger } from './log';

export interface HlsErrorData {
  fatal: boolean;
  type: string;
  details: string;
  response?: { code: number };
  frag?: { url?: string };
  url?: string;
  context?: { url?: string };
}

const extractDomain = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

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
  cssPrefix: string,
): void => {
  const failedUrl = getFailedUrl(data);
  const domain = extractDomain(failedUrl);
  const message = getErrorMessage(data.type, data.details);
  const debug = formatHlsErrorDebug(data);

  log.error('playbackError {message} {domain} {debug}', { message, domain, debug });

  $root.html(
    '<div class="' + cssPrefix + '">' +
      '<div class="' + cssPrefix + '__title" style="padding:60px;">' +
        '<div>' + message + '</div>' +
        (domain ? '<div class="player__error-debug">' + domain + '</div>' : '') +
        '<div class="player__error-debug">' + debug + '</div>' +
        '<div class="player__error-debug">' + navigator.userAgent + '</div>' +
      '</div>' +
    '</div>'
  );
};
