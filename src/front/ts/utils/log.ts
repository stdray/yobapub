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

const sendToBackend = (level: Level, message: string, props: Record<string, unknown>, traceId?: string): void => {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/log', true);
    xhr.setRequestHeader('Content-Type', 'application/json');
    const body: Record<string, unknown> = {
      level,
      category: typeof props['category'] === 'string' ? props['category'] : '',
      message,
      props,
      deviceId: storage.getDeviceId(),
      clientTs: Date.now()
    };
    if (traceId) body['traceId'] = traceId;
    xhr.send(JSON.stringify(body));
  } catch (_) { /* fire-and-forget */ }
};

const emit = (level: Level, template: string, props: Record<string, unknown>, traceId?: string): void => {
  const message = renderTemplate(template, props);
  sendToBackend(level, message, props, traceId);
  const traceTag = traceId ? '[' + traceId + ']' : '';
  const console_msg = '[' + relTs() + '][' + level[0] + ']' + traceTag + ' ' + message;
  switch (level) {
    case 'Warning': console.warn(console_msg, props); break;
    case 'Error':   console.error(console_msg, props); break;
    default:        console.log(console_msg, props); break;
  }
};

const generateTraceId = (): string => {
  const chars = '0123456789abcdef';
  let result = '';
  for (let i = 0; i < 4; i++) result += chars[Math.floor(Math.random() * 16)];
  return result;
};

export class Logger {
  private traceId?: string;

  constructor(private readonly category: string) {}

  setTraceId = (id: string): void => { this.traceId = id; };
  newTraceId = (): string => { this.traceId = generateTraceId(); return this.traceId; };
  getTraceId = (): string | undefined => this.traceId;
  clearTraceId = (): void => { this.traceId = undefined; };

  info = (template: string, props?: Record<string, unknown>): void => {
    emit('Information', template, { category: this.category, ...props }, this.traceId);
  };

  debug = (template: string, props?: Record<string, unknown>): void => {
    emit('Verbose', template, { category: this.category, ...props }, this.traceId);
  };

  warn = (template: string, props?: Record<string, unknown>): void => {
    emit('Warning', template, { category: this.category, ...props }, this.traceId);
  };

  error = (template: string, props?: Record<string, unknown>): void => {
    emit('Error', template, { category: this.category, ...props }, this.traceId);
  };
}
