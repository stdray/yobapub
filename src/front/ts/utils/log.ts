// Structured logger. Console-only for now; Seq transport to be added later.

type Level = 'Verbose' | 'Debug' | 'Information' | 'Warning' | 'Error';

const PAGE_T0 = Date.now();

function relTs(): string {
  return '+' + ((Date.now() - PAGE_T0) / 1000).toFixed(3) + 's';
}

function renderTemplate(template: string, props: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const v = props[key];
    return v === undefined ? '{' + key + '}' : String(v);
  });
}

function emit(level: Level, template: string, props: Record<string, unknown>): void {
  const rendered = '[' + relTs() + '][' + level[0] + '] ' + renderTemplate(template, props);
  switch (level) {
    case 'Warning': console.warn(rendered, props); break;
    case 'Error':   console.error(rendered, props); break;
    default:        console.log(rendered, props); break;
  }
}

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
