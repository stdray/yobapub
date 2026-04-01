// Structured logger. Logs to console and to the backend /api/log endpoint.

import { storage } from './storage';

type Level = 'Verbose' | 'Debug' | 'Information' | 'Warning' | 'Error';

const PAGE_T0 = Date.now();

const relTs = (): string =>
  '+' + ((Date.now() - PAGE_T0) / 1000).toFixed(3) + 's';

const renderTemplate = (template: string, props: Record<string, unknown>): string =>
  template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = props[key];
    return v === undefined ? '{' + key + '}' : String(v);
  });

const sendToBackend = (level: Level, message: string, props: Record<string, unknown>): void => {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/log', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.send(JSON.stringify({
      level,
      category: typeof props['category'] === 'string' ? props['category'] : '',
      message,
      props,
      deviceId: storage.getDeviceId(),
      clientTs: Date.now()
    }));
  } catch (_) { /* fire-and-forget */ }
};

const emit = (level: Level, template: string, props: Record<string, unknown>): void => {
  const message = renderTemplate(template, props);
  sendToBackend(level, message, props);
  const console_msg = '[' + relTs() + '][' + level[0] + '] ' + message;
  switch (level) {
    case 'Warning': console.warn(console_msg, props); break;
    case 'Error':   console.error(console_msg, props); break;
    default:        console.log(console_msg, props); break;
  }
};

export class Logger {
  constructor(private readonly category: string) {}

  info(template: string, props?: Record<string, unknown>): void {
    emit('Information', template, { category: this.category, ...props });
  }

  debug(template: string, props?: Record<string, unknown>): void {
    emit('Verbose', template, { category: this.category, ...props });
  }

  warn(template: string, props?: Record<string, unknown>): void {
    emit('Warning', template, { category: this.category, ...props });
  }

  error(template: string, props?: Record<string, unknown>): void {
    emit('Error', template, { category: this.category, ...props });
  }
}
