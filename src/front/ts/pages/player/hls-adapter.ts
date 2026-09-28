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

// Local — hls-engine.ts exports its own `formatBuffered` for log lines, but
// hls-engine.ts imports from this module, so importing back would be circular.
const formatBufferedRanges = (v: HTMLVideoElement): string => {
  if (v.buffered.length === 0) return '[none]';
  const parts: string[] = [];
  for (let i = 0; i < v.buffered.length; i++) {
    parts.push(v.buffered.start(i).toFixed(1) + '-' + v.buffered.end(i).toFixed(1));
  }
  return parts.join(',');
};

interface BufferedRange {
  readonly start: number;
  readonly end: number;
}

const toBufferedRanges = (v: HTMLVideoElement): ReadonlyArray<BufferedRange> => {
  const ranges: BufferedRange[] = [];
  for (let i = 0; i < v.buffered.length; i++) {
    ranges.push({ start: v.buffered.start(i), end: v.buffered.end(i) });
  }
  return ranges;
};

// If a performUserSeek() continuation (drain wait or flush wait) hasn't run
// by this long, run it anyway rather than leave hls.js stuck STOPPED forever.
const LEGACY_SEEK_FLUSH_FALLBACK_MS = 3000;

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

  // Commits a USER-initiated seek (as opposed to the startup resume-seek or
  // an internal watchdog/gap-controller seek) — the adapter owns the actual
  // currentTime assignment because legacy needs to sequence it against
  // stopLoad/flush/startLoad (see HlsAdapterLegacy). Modern default: a plain
  // assignment, identical to what the caller used to do directly.
  performUserSeek(video: HTMLVideoElement, target: number): void {
    video.currentTime = target;
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
  // The level hls.js is currently fetching fragments for. Unlike currentLevel
  // (the level actually being rendered, which can legitimately read -1 right
  // after a source swap or during a level switch), loadLevel stays populated
  // — used as a fallback for error diagnostics when currentLevel is -1.
  get loadLevel(): number { return this.hls.loadLevel; }

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
  // Approximates buffer-controller's private pending-append queue depth from
  // public events only (BUFFER_APPENDING/BUFFER_APPENDED), so performUserSeek
  // can wait for it to drain before flushing — see performUserSeek.
  private appendDepth = 0;
  // Cancels an in-flight performUserSeek() continuation (drain wait or flush
  // wait) so only the latest seek's continuation can ever run.
  private cancelPendingSeek: (() => void) | null = null;

  constructor(cfg: Partial<Hls.Config>, log: Logger) {
    super(cfg, log);
    this.hls.on(Hls.Events.BUFFER_APPENDING, (): void => { this.appendDepth++; });
    this.hls.on(Hls.Events.BUFFER_APPENDED, (): void => {
      this.appendDepth = Math.max(0, this.appendDepth - 1);
    });
    const resetAppendDepth = (): void => { this.appendDepth = 0; };
    this.hls.on(Hls.Events.BUFFER_RESET, resetAppendDepth);
    this.hls.on(Hls.Events.MANIFEST_LOADING, resetAppendDepth);
    this.hls.on(Hls.Events.MEDIA_DETACHING, resetAppendDepth);
  }

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

  // Only runs on the legacy (0.14.x) hls.js build — chosen via the device
  // setting `kp_legacy_hls`/`kp_legacy_hls_forced`, not by Tizen version.
  //
  // Why: rapid backward seeks fragment the buffer into disjoint islands
  // (stale fragments from the pre-seek load land next to the new target);
  // appending across an unmerged junction later can silently drop audio with
  // no hls.js/MSE event (open incident tizen23-audio-loss). This collapses
  // the buffer to one clean island at `target` on every user seek.
  //
  // Ordering: currentTime must be assigned before startLoad() — hls.js 0.14's
  // `_doTickIdle` reads media.currentTime (not the startLoad arg) once
  // loadedmetadata is true, so calling startLoad first would fetch the
  // fragment after the STALE playhead, i.e. the very fragment we're trying to
  // kill (mirrors the proven applyPendingStartSeek order). It's safe to
  // assign currentTime immediately, even before the drain/flush waits below:
  // hls.js stays STOPPED throughout, and onMediaSeeking while STOPPED only
  // records lastCurrentTime — doTick() no-ops for State.STOPPED — so nothing
  // reacts early, and the scrubber updates without waiting on network timing.
  //
  // Two async gates before startLoad() can safely run:
  //  1. Append drain — buffer-controller queues already-demuxed segments
  //     independently of stopLoad()/flush (see appendDepth). Flushing while
  //     one is still landing would let it get appended AFTER the flush,
  //     recreating a stale island invisible in video.buffered. Wait for
  //     appendDepth to reach 0 first — stopLoad() already guarantees the
  //     queue can only shrink from here (demuxer destroyed, no new fragments
  //     parsed) — so this reliably converges. This closes the residual gap
  //     using only public events; there is no public API to drop the queue
  //     directly.
  //  2. Flush — sourceBuffer.remove() is async; wait for BUFFER_FLUSHED.
  //
  // Each wait uses armSeekContinuation: a listener registered BEFORE the
  // triggering call (doFlush can resolve synchronously with nothing
  // in-flight, and a listener added after would miss it, leaving hls.js
  // stuck STOPPED with no watchdog to rescue it — stopLoad already killed
  // the tick interval) plus a fallback timer, so the continuation always
  // runs exactly once. Only the latest seek's continuation can run: an
  // earlier one is cancelled by a newer call and by destroy().
  performUserSeek(v: HTMLVideoElement, target: number): void {
    if (this.cancelPendingSeek) { this.cancelPendingSeek(); this.cancelPendingSeek = null; }

    const before = formatBufferedRanges(v);
    this.hls.stopLoad();
    v.currentTime = target;
    const depth = this.appendDepth;
    this.log.info('legacySeekFlush target={target} ct={ct} before={before} depth={depth}', {
      target, ct: v.currentTime, before, depth,
    });

    if (depth > 0) {
      this.log.warn('legacySeekFlush drain depth={depth}', { depth });
      this.cancelPendingSeek = this.armSeekContinuation('drain', (fire) => {
        const onAppended = (): void => { if (this.appendDepth <= 0) fire(); };
        this.hls.on(Hls.Events.BUFFER_APPENDED, onAppended);
        return (): void => this.hls.off(Hls.Events.BUFFER_APPENDED, onAppended);
      }, (): void => this.flushAndLoad(v, target));
      return;
    }

    this.flushAndLoad(v, target);
  }

  // Flushes every buffered range that doesn't contain `target`, then starts
  // loading at `target`. Listener-before-trigger (see performUserSeek gate 2).
  private flushAndLoad(v: HTMLVideoElement, target: number): void {
    const startLoadForTarget = (): void => {
      this.hls.startLoad(target);
      this.log.info('legacySeekFlush done target={target} after={after}', {
        target, after: formatBufferedRanges(v),
      });
    };

    const plan = this.planFlush(v, target);
    this.log.info('legacySeekFlush kept={kept}', { kept: plan.range });
    if (plan.ranges.length === 0) {
      startLoadForTarget();
      return;
    }

    this.cancelPendingSeek = this.armSeekContinuation('flush', (fire) => {
      const onFlushed = (): void => fire();
      this.hls.on(Hls.Events.BUFFER_FLUSHED, onFlushed);
      return (): void => this.hls.off(Hls.Events.BUFFER_FLUSHED, onFlushed);
    }, startLoadForTarget);
    plan.ranges.forEach((r) => this.flushBuffer(r.start, r.end));
  }

  // Buffered ranges to flush so `target` ends up the sole clean island (or
  // the sentinel [0, +Inf] when no range contains it at all). Pure — issues
  // no flushBuffer() calls — so the caller can arm its listener first.
  private planFlush(v: HTMLVideoElement, target: number): { readonly range: string; readonly ranges: ReadonlyArray<BufferedRange> } {
    const ranges = toBufferedRanges(v);
    const containsTarget = (r: BufferedRange): boolean => target >= r.start && target <= r.end;
    const kept = ranges.filter(containsTarget)[0];
    if (!kept) {
      return { range: 'none', ranges: ranges.length > 0 ? [{ start: 0, end: Number.POSITIVE_INFINITY }] : [] };
    }
    return { range: kept.start.toFixed(1) + '-' + kept.end.toFixed(1), ranges: ranges.filter((r) => !containsTarget(r)) };
  }

  // Runs `action` exactly once: when `attach`'s `fire` callback signals
  // readiness, or after LEGACY_SEEK_FLUSH_FALLBACK_MS, whichever is first —
  // logging a warning in the fallback case. Returns a canceller that clears
  // both the listener and the timer without running `action`.
  private armSeekContinuation(stage: string, attach: (fire: () => void) => (() => void), action: () => void): () => void {
    let done = false;
    const finish = (viaFallback: boolean): void => {
      if (done) return;
      done = true;
      detach();
      window.clearTimeout(timer);
      if (viaFallback) this.log.warn('legacySeekFlush fallback stage={stage}', { stage });
      action();
    };
    const detach = attach((): void => finish(false));
    const timer = window.setTimeout((): void => finish(true), LEGACY_SEEK_FLUSH_FALLBACK_MS);
    return (): void => {
      if (done) return;
      done = true;
      detach();
      window.clearTimeout(timer);
    };
  }

  destroy(): void {
    if (this.cancelPendingSeek) { this.cancelPendingSeek(); this.cancelPendingSeek = null; }
    super.destroy();
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
