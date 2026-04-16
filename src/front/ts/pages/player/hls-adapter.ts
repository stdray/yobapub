import Hls from 'hls.js';

// HlsAdapter — thin wrapper over an `Hls` instance that hides the differences
// between hls.js 0.14.x (legacy) and 1.5+ (modern) from the player code.
//
// The only real runtime difference between the two versions in what we use is
// the shape of ERROR event data: 0.14 exposes `reason` / `response.code`;
// 1.5+ moved them under `error.message` / `context.response.status` and added
// new fields. Everything else (event names, instance methods, config keys,
// `levels[]`) is API-compatible. So the base class holds all shared plumbing
// and delegates only error normalization to the subclass via `normalizeError`.

// -------- Public normalized types (what player code sees) --------

export interface HlsError {
  readonly type: string;
  readonly details: string;
  readonly fatal: boolean;
  readonly httpStatus: number | null;
  readonly url: string | null;
  readonly message: string;
}

export interface HlsFragInfo {
  readonly sn: number;
  readonly start: number;
  readonly duration: number;
  readonly type: string | null;
  readonly url: string | null;
}

export interface HlsFragStats {
  readonly total: number;
  readonly trequest: number;
  readonly tfirst: number;
  readonly tload: number;
}

export interface HlsFragLoaded {
  readonly frag: HlsFragInfo;
  readonly stats: HlsFragStats | null;
}

export interface HlsLevelSwitch {
  readonly level: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly bitrate: number | null;
  readonly videoCodec: string | null;
  readonly audioCodec: string | null;
}

export interface HlsManifestLoaded {
  readonly url: string | null;
  readonly levelCount: number;
}

export interface HlsLevelLoading {
  readonly level: number | null;
  readonly url: string | null;
}

export interface HlsLevelLoaded {
  readonly levelId: number | null;
  readonly loadMs: number | null;
}

export interface HlsLevelInfo {
  readonly width: number;
  readonly height: number;
  readonly bitrate: number;
  readonly videoCodec: string | null;
  readonly audioCodec: string | null;
}

// -------- Raw per-version error shapes (private — live inside subclasses) --------

interface HlsErrorDataLegacy {
  readonly type: string;
  readonly details: string;
  readonly fatal: boolean;
  readonly reason?: string;
  readonly response?: { readonly code?: number };
  readonly url?: string;
  readonly frag?: { readonly url?: string };
  readonly context?: { readonly url?: string };
}

interface HlsErrorDataModern {
  readonly type: string;
  readonly details: string;
  readonly fatal: boolean;
  readonly error?: { readonly message?: string };
  readonly context?: { readonly url?: string; readonly response?: { readonly status?: number } };
  readonly frag?: { readonly url?: string };
}

// -------- Raw payload shapes used inside event handlers (pre-normalization) --------

interface RawFrag {
  readonly sn?: number;
  readonly start?: number;
  readonly duration?: number;
  readonly type?: string;
  readonly url?: string;
}

interface RawStats {
  readonly total?: number;
  readonly trequest?: number;
  readonly tfirst?: number;
  readonly tload?: number;
}

const toFragInfo = (f: RawFrag | undefined): HlsFragInfo | null => {
  if (!f || f.sn === undefined || f.start === undefined || f.duration === undefined) return null;
  return {
    sn: f.sn,
    start: f.start,
    duration: f.duration,
    type: f.type || null,
    url: f.url || null,
  };
};

const toStats = (s: RawStats | undefined): HlsFragStats | null => {
  if (!s || s.total === undefined) return null;
  return {
    total: s.total,
    trequest: s.trequest ?? 0,
    tfirst: s.tfirst ?? 0,
    tload: s.tload ?? 0,
  };
};

// -------- Base adapter --------

export abstract class HlsAdapter {
  protected readonly hls: Hls;

  constructor(cfg: Partial<Hls.Config>) {
    this.hls = new Hls(cfg);
  }

  get version(): string { return Hls.version || 'unknown'; }

  static get runtimeVersion(): string { return Hls.version || 'unknown'; }
  static isSupported(): boolean { return Hls.isSupported(); }

  // lifecycle
  loadSource(url: string): void { this.hls.loadSource(url); }
  attachMedia(v: HTMLVideoElement): void { this.hls.attachMedia(v); }
  destroy(): void { this.hls.destroy(); }
  startLoad(pos: number): void { this.hls.startLoad(pos); }
  stopLoad(): void { this.hls.stopLoad(); }
  recoverMediaError(): void { this.hls.recoverMediaError(); }

  // levels
  get levels(): ReadonlyArray<HlsLevelInfo> {
    const raw = this.hls.levels || [];
    return raw.map((l) => ({
      width: l.width || 0,
      height: l.height || 0,
      bitrate: l.bitrate || 0,
      videoCodec: l.videoCodec || null,
      audioCodec: l.audioCodec || null,
    }));
  }
  get currentLevel(): number { return this.hls.currentLevel; }
  set currentLevel(i: number) { this.hls.currentLevel = i; }

  // flush (used by legacy start-seek workaround; harmless on modern but unused there)
  flushBuffer(startOffset: number, endOffset: number): void {
    this.hls.trigger(Hls.Events.BUFFER_FLUSHING, { startOffset, endOffset });
  }

  // events — each method hides raw hls.js payload types from callers.
  // Internal handlers use `unknown` + local sugaring: @types/hls.js overloads
  // .on() per event, and modern runtime adds optional fields not in those
  // types. Treating payloads as `unknown` + narrowing per-field is honest
  // (we read what we actually need, defensively) and avoids a cascade of
  // `as unknown as Hls.xxxData` casts.

  onError(cb: (e: HlsError) => void): void {
    this.hls.on(Hls.Events.ERROR, (_e: string, raw: unknown): void => {
      cb(this.normalizeError(raw));
    });
  }

  onFragLoading(cb: (frag: HlsFragInfo) => void): void {
    this.hls.on(Hls.Events.FRAG_LOADING, (_e: string, d: unknown): void => {
      const frag = toFragInfo((d as { frag?: RawFrag }).frag);
      if (frag) cb(frag);
    });
  }

  onFragLoaded(cb: (p: HlsFragLoaded) => void): void {
    this.hls.on(Hls.Events.FRAG_LOADED, (_e: string, d: unknown): void => {
      const raw = d as { frag?: RawFrag; stats?: RawStats };
      const frag = toFragInfo(raw.frag);
      if (!frag) return;
      cb({ frag, stats: toStats(raw.stats) });
    });
  }

  onFragBuffered(cb: (frag: HlsFragInfo) => void): void {
    this.hls.on(Hls.Events.FRAG_BUFFERED, (_e: string, d: unknown): void => {
      const frag = toFragInfo((d as { frag?: RawFrag }).frag);
      if (frag) cb(frag);
    });
  }

  onLevelSwitching(cb: (s: HlsLevelSwitch) => void): void {
    this.hls.on(Hls.Events.LEVEL_SWITCHING, (_e: string, d: unknown): void => {
      const r = d as {
        level?: number; width?: number; height?: number;
        bitrate?: number; videoCodec?: string; audioCodec?: string;
      };
      cb({
        level: r.level ?? null,
        width: r.width ?? null,
        height: r.height ?? null,
        bitrate: r.bitrate ?? null,
        videoCodec: r.videoCodec || null,
        audioCodec: r.audioCodec || null,
      });
    });
  }

  onLevelSwitched(cb: (level: number | null) => void): void {
    this.hls.on(Hls.Events.LEVEL_SWITCHED, (_e: string, d: unknown): void => {
      cb((d as { level?: number }).level ?? null);
    });
  }

  onManifestLoaded(cb: (m: HlsManifestLoaded) => void): void {
    this.hls.on(Hls.Events.MANIFEST_LOADED, (_e: string, d: unknown): void => {
      const r = d as { url?: string; levels?: ReadonlyArray<unknown> };
      cb({ url: r.url || null, levelCount: r.levels ? r.levels.length : 0 });
    });
  }

  onLevelLoading(cb: (l: HlsLevelLoading) => void): void {
    this.hls.on(Hls.Events.LEVEL_LOADING, (_e: string, d: unknown): void => {
      const r = d as { level?: number; url?: string };
      cb({ level: r.level ?? null, url: r.url || null });
    });
  }

  onLevelLoaded(cb: (l: HlsLevelLoaded) => void): void {
    this.hls.on(Hls.Events.LEVEL_LOADED, (_e: string, d: unknown): void => {
      const r = d as { levelId?: number; level?: number; stats?: RawStats };
      const stats = toStats(r.stats);
      const loadMs = stats ? stats.tload - stats.trequest : null;
      cb({ levelId: r.levelId ?? r.level ?? null, loadMs });
    });
  }

  onManifestParsed(cb: () => void): void {
    this.hls.on(Hls.Events.MANIFEST_PARSED, (): void => { cb(); });
  }

  protected abstract normalizeError(raw: unknown): HlsError;
}

// -------- Subclasses: only normalizeError differs --------

export class HlsAdapterLegacy extends HlsAdapter {
  protected normalizeError(raw: unknown): HlsError {
    const d = raw as HlsErrorDataLegacy;
    return {
      type: d.type,
      details: d.details,
      fatal: d.fatal,
      httpStatus: d.response?.code ?? null,
      url: d.frag?.url ?? d.url ?? d.context?.url ?? null,
      message: d.reason ?? d.details,
    };
  }
}

export class HlsAdapterModern extends HlsAdapter {
  protected normalizeError(raw: unknown): HlsError {
    const d = raw as HlsErrorDataModern;
    return {
      type: d.type,
      details: d.details,
      fatal: d.fatal,
      httpStatus: d.context?.response?.status ?? null,
      url: d.frag?.url ?? d.context?.url ?? null,
      message: d.error?.message ?? d.details,
    };
  }
}

// -------- Factory --------

export const isModernHls = (): boolean => !/^0\./.test(Hls.version || '');

export const createHlsAdapter = (cfg: Partial<Hls.Config>): HlsAdapter =>
  isModernHls() ? new HlsAdapterModern(cfg) : new HlsAdapterLegacy(cfg);
