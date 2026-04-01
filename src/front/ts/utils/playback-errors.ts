import { getDeviceId } from './storage';

const DAY_MS = 86400000;
const reported = new Map<string, number>();

const extractDomain = (url: string): string => {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
};

export const reportPlaybackError = (url: string, errorDetails: string): void => {
  const domain = extractDomain(url);
  if (!domain) return;

  const now = Date.now();
  const lastReported = reported.get(domain);
  if (lastReported !== undefined && now - lastReported < DAY_MS) return;

  reported.set(domain, now);

  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/playback-error', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify({
      url: url.substring(0, 500),
      deviceId: getDeviceId(),
      userAgent: navigator.userAgent,
      errorDetails: errorDetails
    }));
  } catch (_) { /* fire-and-forget */ }
};
