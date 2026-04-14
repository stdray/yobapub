import { storage } from './storage';
import { extractHostname } from './url';

const DAY_MS = 86400000;
const reported: Record<string, number> = {};

export const reportPlaybackError = (url: string, errorDetails: string): void => {
  const domain = extractHostname(url);
  if (!domain) return;

  const now = Date.now();
  const lastReported = reported[domain];
  if (lastReported !== undefined && now - lastReported < DAY_MS) return;

  reported[domain] = now;

  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/playback-error', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify({
      url: url.substring(0, 500),
      deviceId: storage.getDeviceId(),
      userAgent: navigator.userAgent,
      errorDetails: errorDetails
    }));
  } catch (_) { /* fire-and-forget */ }
};
