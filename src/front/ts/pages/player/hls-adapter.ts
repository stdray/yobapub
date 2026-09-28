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
  // Cancels a not-yet-fired BUFFER_FLUSHED continuation from an earlier
  // performUserSeek() call (see performUserSeek for why this is needed).
  private cancelPendingSeekFlush: (() => void) | null = null;

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

  // This whole method only runs when hls.js picked the legacy (0.14.x) build,
  // which happens whenever the device setting / localStorage `kp_legacy_hls`
  // (or the forced override `kp_legacy_hls_forced`) selects it — that is a
  // user/device SETTING, not a Tizen-version check, so "legacy" here means
  // "this HLS build", not "this hardware". HlsAdapterModern (and hence any
  // device currently running the modern build, including Tizen 3 today) is
  // untouched by this method — but only because of that setting, not because
  // of any hardware detection.
  //
  // Backward seeks during rapid seek-flurries fragment the buffer into
  // disjoint islands (stale fragments from the pre-seek load land next to the
  // new target); appending across an island junction later can silently drop
  // audio frames with no hls.js/MSE event (see decision log / open incident
  // tizen23-audio-loss). Collapse to a single clean island at `target` on
  // every user seek: abort the stale load, flush every range that doesn't
  // already contain the target, assign currentTime, THEN restart loading.
  //
  // Ordering matters: hls.js 0.14's stream-controller `_doTickIdle` reads
  // `media.currentTime` (not the position passed to startLoad) once
  // `loadedmetadata` is true, so startLoad() must run AFTER currentTime is
  // assigned — calling it before would tick at the stale playhead and
  // request the very stale fragment this method exists to kill. This mirrors
  // the proven applyPendingStartSeek order (stopLoad -> currentTime ->
  // startLoad), just with a flush spliced in between stopLoad and the
  // currentTime assignment.
  //
  // The flush itself (sourceBuffer.remove()) is async, so startLoad is
  // deferred to the BUFFER_FLUSHED that follows — same pattern hls.js's own
  // buffer-controller uses internally (flushBuffer -> doFlush -> onSBUpdateEnd
  // -> BUFFER_FLUSHED). If nothing needed flushing (already a single clean
  // island at target) no BUFFER_FLUSHED will fire, so startLoad runs inline.
  // Only the LATEST seek's continuation may fire — an earlier one is
  // cancelled if superseded by a fresh call, and on destroy() — so rapid
  // repeated seeks (this flurry was captured doing 7 in ~3s) don't race.
  //
  // NOTE (known gap, not fixed here): hls.js 0.14's buffer-controller queues
  // already-demuxed segments in a private `segments` array (onBufferAppending)
  // that is independent of stopLoad()/flush — flushBuffer only removes
  // already-appended SourceBuffer ranges via sourceBuffer.remove(). Any
  // segment that was parsed and queued before this seek (in flight between
  // FRAG_LOADED and FRAG_BUFFERED) will still be appended after the flush
  // completes, because doAppending() resumes from that queue once
  // `_needsFlush` clears. There is no public API to drop it — the only way to
  // clear buffer-controller.segments is BUFFER_RESET, which also tears down
  // and recreates the SourceBuffers (removeSourceBuffer/addSourceBuffer),
  // which is not a safe thing to do mid-playback without reduplicating
  // buffer-controller's own codec/track bookkeeping. Not worth monkeypatching
  // private state for a narrow window; left as a residual risk.
  performUserSeek(v: HTMLVideoElement, target: number): void {
    if (this.cancelPendingSeekFlush) { this.cancelPendingSeekFlush(); this.cancelPendingSeekFlush = null; }

    const before = formatBufferedRanges(v);
    this.hls.stopLoad();
    const kept = this.flushNonContainingRanges(v, target);
    v.currentTime = target;

    this.log.info('legacySeekFlush target={target} ct={ct} before={before} kept={kept}', {
      target, ct: v.currentTime, before, kept: kept.range,
    });

    const startLoadForTarget = (): void => {
      this.hls.startLoad(target);
      this.log.info('legacySeekFlush done target={target} after={after}', {
        target, after: formatBufferedRanges(v),
      });
    };

    if (kept.anyFlushed) {
      const onFlushed = (): void => { this.cancelPendingSeekFlush = null; startLoadForTarget(); };
      this.hls.once(Hls.Events.BUFFER_FLUSHED, onFlushed);
      this.cancelPendingSeekFlush = (): void => this.hls.off(Hls.Events.BUFFER_FLUSHED, onFlushed);
    } else {
      startLoadForTarget();
    }
  }

  // Flushes every buffered range that does not contain `target` (or the whole
  // buffer when no range contains it). Returns the kept range for logging and
  // whether any flush was actually queued (i.e. whether a BUFFER_FLUSHED will
  // follow).
  private flushNonContainingRanges(v: HTMLVideoElement, target: number): { readonly range: string; readonly anyFlushed: boolean } {
    const ranges = toBufferedRanges(v);
    const containsTarget = (r: BufferedRange): boolean => target >= r.start && target <= r.end;
    const kept = ranges.filter(containsTarget)[0];
    if (!kept) {
      const anyFlushed = ranges.length > 0;
      if (anyFlushed) this.flushBuffer(0, Number.POSITIVE_INFINITY);
      return { range: 'none', anyFlushed };
    }
    const stale = ranges.filter((r) => !containsTarget(r));
    stale.forEach((r) => this.flushBuffer(r.start, r.end));
    return { range: kept.start.toFixed(1) + '-' + kept.end.toFixed(1), anyFlushed: stale.length > 0 };
  }

  destroy(): void {
    if (this.cancelPendingSeekFlush) { this.cancelPendingSeekFlush(); this.cancelPendingSeekFlush = null; }
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
