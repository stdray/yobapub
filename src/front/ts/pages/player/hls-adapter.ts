import Hls from 'hls.js';
import { Logger } from '../../utils/log';

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

  constructor(cfg: Partial<Hls.Config>, protected readonly log: Logger) {
    this.hls = new Hls(cfg);
  }

  // Start playback from a saved position. Default (modern) path: hls.js seeks
  // natively via startLoad(startPos). Legacy overrides this with a FRAG_BUFFERED
  // dance to work around Tizen 2.3 A/V desync on `_seekToStartPos` (see
  // HlsAdapterLegacy + decision log 2026-04-13).
  startPlayback(_video: HTMLVideoElement, startPos: number): void {
    this.hls.startLoad(startPos);
  }

  // Hooks for <video> events. Legacy uses these to snap currentTime past the
  // first-fragment PTS boundary; modern doesn't need them.
  onVideoSeeking(_video: HTMLVideoElement): void { /* no-op on modern */ }
  onVideoCanplay(_video: HTMLVideoElement): void { /* no-op on modern */ }

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
  // Tizen 2.3: hls.js 0.14 `_seekToStartPos` fires a seek during decoder warmup
  // that corrupts A/V sync. We start from 0, wait for the first fragment to land
  // in SourceBuffer, then do a user-style seek to the saved position and manually
  // flush [0..target-1]. See decision log 2026-04-13 19:45 / 17:55.
  private firstFragSnapped = false;
  private pendingStartSeek = 0;

  startPlayback(video: HTMLVideoElement, startPos: number): void {
    this.pendingStartSeek = startPos > 0 ? startPos : 0;
    this.firstFragSnapped = false;
    this.hls.on(Hls.Events.FRAG_BUFFERED, (): void => this.applyPendingStartSeek(video));
    this.hls.startLoad(0);
  }

  onVideoSeeking(v: HTMLVideoElement): void {
    if (this.firstFragSnapped || v.buffered.length === 0) return;
    const bStart = v.buffered.start(0);
    if (v.currentTime < bStart && bStart - v.currentTime < 1) {
      this.firstFragSnapped = true;
      const target = bStart + 0.05;
      this.log.info('startupSeekSnap ct={ct} bStart={bStart} -> {target}', {
        ct: v.currentTime, bStart, target,
      });
      v.currentTime = target;
    }
  }

  onVideoCanplay(v: HTMLVideoElement): void {
    if (this.pendingStartSeek !== 0 || this.firstFragSnapped) return;
    if (v.buffered.length === 0 || v.currentTime >= v.buffered.start(0)) return;
    const target = v.buffered.start(0) + 0.05;
    this.firstFragSnapped = true;
    this.log.info('startSeek pts-snap target={target} from ct={ct}', {
      target, ct: v.currentTime,
    });
    v.currentTime = target;
  }

  private applyPendingStartSeek(v: HTMLVideoElement): void {
    if (this.pendingStartSeek <= 0 || v.buffered.length === 0) return;
    const target = this.pendingStartSeek;
    this.pendingStartSeek = 0;
    this.firstFragSnapped = true;
    this.log.info('startSeek target={target} from ct={ct}', { target, ct: v.currentTime });
    // Stop loading before seek so hls.js doesn't keep fetching the next sequential
    // fragment from the beginning; restart at the seek target after the assignment.
    this.hls.stopLoad();
    v.currentTime = target;
    this.hls.startLoad(target);
    // Drop the [0..target-1] leftover buffered from sn=1.
    this.flushBuffer(0, target - 1);
  }

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

export const createHlsAdapter = (cfg: Partial<Hls.Config>, log: Logger): HlsAdapter =>
  isModernHls() ? new HlsAdapterModern(cfg, log) : new HlsAdapterLegacy(cfg, log);
