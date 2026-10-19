import Hls from 'hls.js';
import { Logger } from '../../utils/log';
import { platform } from '../../utils/platform';
import { storage } from '../../utils/storage';

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
const formatBufferedRanges = (v: HTMLVideoElement | null): string => {
  if (!v || v.buffered.length === 0) return '[none]';
  const parts: string[] = [];
  for (let i = 0; i < v.buffered.length; i++) {
    parts.push(v.buffered.start(i).toFixed(1) + '-' + v.buffered.end(i).toFixed(1));
  }
  return parts.join(',');
};

// After a flushed reload the playhead must not sit within this distance of
// buffered.start(0): Tizen 2.3 stops emitting events when it does.
const POST_RELOAD_CLAMP_GAP_S = 0.3;

// If a performUserSeek() continuation (drain wait or flush wait) hasn't run
// by this long, run it anyway rather than leave hls.js stuck STOPPED forever.
const LEGACY_SEEK_FLUSH_FALLBACK_MS = 3000;

// Startup resume-seek warmup (see applyPendingStartSeek). At the first
// FRAG_BUFFERED the playhead can still sit at ct=0, 1.4 s BEFORE
// buffered.start(0) — seeking to the resume target right then leaves A/V
// desync (measured on Tizen 2.3, builds 2.1.1-51/-54). So: snap the playhead
// past the range boundary without the 1 s guard used by onVideoSeeking, then
// wait for real playback progress before running the resume seek.
const START_WARMUP_SNAP_OFFSET_S = 0.05;
const START_WARMUP_PROGRESS_S = 0.5;
const START_WARMUP_FALLBACK_MS = 2000;

type StartWarmupReason = 'progress' | 'timeout';

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
  // Monotonic id of the latest user seek, stamped on every seek-path log line
  // plus the FRAG_PARSED/BUFFER_* probes, so one repro can be correlated.
  private seekGen = 0;
  // The adapter only receives the <video> via attachMedia(); kept for probe
  // logging and the post-reload clamp.
  private video: HTMLVideoElement | null = null;
  // Set by flushAndLoad when a flushed buffer is reloaded; consumed by the
  // first FRAG_BUFFERED (see applyPostReloadClamp). Never set on the startup path.
  private pendingPostReloadClamp = false;
  // True while the startup warmup (snap → wait for progress) is armed and the
  // resume seek has NOT run yet. Blocks re-arming from later FRAG_BUFFERED
  // events so the resume seek can fire exactly once.
  private startWarmupArmed = false;
  // Cancels the in-flight startup warmup (timeupdate listener + fallback timer)
  // on destroy() or on a new startPlayback().
  private cancelStartWarmup: (() => void) | null = null;

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

    // Playback telemetry around the append pipeline (one line per fragment /
    // append, nothing per timeupdate). These fill the blind zone between
    // "flush done" and "FRAG_BUFFERED" — the exact point where the 2026-10-19
    // Tizen 2.3 hang produced no events at all.
    this.hls.on(Hls.Events.FRAG_PARSED, (_e: string, d: unknown): void => {
      const frag = toFragInfo((d as { frag?: RawFrag }).frag);
      const v = this.video;
      this.log.info('hls FRAG_PARSED gen={gen} sn={sn} start={start} ct={ct} br={br}', {
        gen: this.seekGen,
        sn: frag ? frag.sn : null, start: frag ? frag.start : null,
        ct: v ? v.currentTime : -1, br: formatBufferedRanges(v),
      });
    });
    this.hls.on(Hls.Events.BUFFER_APPENDED, (_e: string, d: unknown): void => {
      const v = this.video;
      this.log.info('hls BUFFER_APPENDED gen={gen} pending={pending} ct={ct} br={br}', {
        gen: this.seekGen,
        pending: (d as { pending?: number }).pending ?? -1,
        ct: v ? v.currentTime : -1, br: formatBufferedRanges(v),
      });
    });
    this.hls.on(Hls.Events.BUFFER_RESET, (): void => {
      const v = this.video;
      this.log.info('hls BUFFER_RESET gen={gen} ct={ct} br={br}', {
        gen: this.seekGen, ct: v ? v.currentTime : -1, br: formatBufferedRanges(v),
      });
    });
  }

  attachMedia(v: HTMLVideoElement): void {
    this.video = v;
    super.attachMedia(v);
  }

  startPlayback(video: HTMLVideoElement, startPos: number): void {
    if (this.cancelStartWarmup) { this.cancelStartWarmup(); this.cancelStartWarmup = null; }
    this.startWarmupArmed = false;
    this.pendingStartSeek = startPos > 0 ? startPos : 0;
    this.firstFragSnapped = false;
    this.hls.on(Hls.Events.FRAG_BUFFERED, (): void => {
      this.applyPendingStartSeek(video);
      this.applyPostReloadClamp(video);
    });
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
  // no hls.js/MSE event (open incident tizen23-audio-loss). So every user
  // seek flushes the WHOLE buffer [0, +Inf) and reloads from `target`.
  //
  // Why not keep the range containing `target`: on-device (Tizen 2.3,
  // 2026-09-28) a complement flush kept=1163.5-1378.0 / 1300.3-1439.8 still
  // ended with `done after=[none]` — MSE remove() of the ADJACENT range wiped
  // the kept range too (likely dependency removal to the next RAP), so the
  // optimisation only forced a reload via an unexpected path. Note also that
  // hls.js 0.14's removeBufferRange skips removals <= 0.5s (buffer-controller.ts).
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
  //
  // EXCEPTION (2026-10-19, Tizen 2.3): when the target lies inside the single
  // contiguous buffered range, the flush is what hung the device — `done
  // after=[none]`, the same fragment reloaded from cache, then no
  // FRAG_BUFFERED/BUFFER_* and no events at all. In that case skip the flush
  // entirely (stopLoad / currentTime / startLoad, the same sequence as
  // applyPendingStartSeek) and leave the buffer intact. The kill switch
  // (storage.isInBufferSeekNoFlush, settings checkbox) restores this path.
  performUserSeek(v: HTMLVideoElement, target: number): void {
    if (this.cancelPendingSeek) { this.cancelPendingSeek(); this.cancelPendingSeek = null; }

    // Snapshot the buffer BEFORE assigning currentTime — the gate and the log
    // line must both see the pre-seek range set.
    const before = formatBufferedRanges(v);
    const gen = ++this.seekGen;
    this.pendingPostReloadClamp = false;

    if (storage.isInBufferSeekNoFlush() && this.seekInsideSingleRange(v, target)) {
      this.hls.stopLoad();
      v.currentTime = target;
      this.hls.startLoad(target);
      this.log.info('legacySeekInBuffer gen={gen} target={target} ct={ct} before={before}', {
        gen, target, ct: v.currentTime, before,
      });
      return;
    }

    this.hls.stopLoad();
    v.currentTime = target;
    const depth = this.appendDepth;
    this.log.info('legacySeekFlush gen={gen} target={target} ct={ct} before={before} depth={depth}', {
      gen, target, ct: v.currentTime, before, depth,
    });

    if (depth > 0) {
      this.log.warn('legacySeekFlush drain gen={gen} depth={depth}', { gen, depth });
      this.cancelPendingSeek = this.armSeekContinuation('drain', (fire) => {
        const onAppended = (): void => { if (this.appendDepth <= 0) fire(); };
        this.hls.on(Hls.Events.BUFFER_APPENDED, onAppended);
        return (): void => this.hls.off(Hls.Events.BUFFER_APPENDED, onAppended);
      }, (): void => {
        // appendDepth can drift upward without a matching BUFFER_APPENDED
        // (segments dropped while _needsFlush, or cleared on QuotaExceeded),
        // which would make every later seek wait out the full fallback.
        this.appendDepth = 0;
        this.flushAndLoad(v, target, gen);
      });
      return;
    }

    this.flushAndLoad(v, target, gen);
  }

  // True only for the legacy adapter on Tizen 2.3 with exactly one buffered
  // range containing the target. Deliberately NOT keyed off the legacy flag
  // alone: legacy hls.js is also used on Tizen 3 via a device setting.
  private seekInsideSingleRange(v: HTMLVideoElement, target: number): boolean {
    if (!platform.isLegacyTizen()) return false;
    if (v.buffered.length !== 1) return false;
    return v.buffered.start(0) <= target && target < v.buffered.end(0);
  }

  // Flushes the WHOLE buffer, then starts loading at `target`. Listener before
  // trigger (see performUserSeek gate 2). Nothing to flush on an empty buffer.
  private flushAndLoad(v: HTMLVideoElement, target: number, gen: number): void {
    const startLoadForTarget = (): void => {
      this.hls.startLoad(target);
      // A flushed buffer is rebuilt from scratch: keep the post-reload clamp
      // armed for the first FRAG_BUFFERED. With the kill switch OFF this stays
      // unarmed, so OFF is exactly the pre-change flush path.
      this.pendingPostReloadClamp = storage.isInBufferSeekNoFlush();
      this.log.info('legacySeekFlush done gen={gen} target={target} after={after}', {
        gen, target, after: formatBufferedRanges(v),
      });
    };

    if (v.buffered.length === 0) {
      startLoadForTarget();
      return;
    }

    this.cancelPendingSeek = this.armSeekContinuation('flush', (fire) => {
      const onFlushed = (): void => fire();
      this.hls.on(Hls.Events.BUFFER_FLUSHED, onFlushed);
      return (): void => this.hls.off(Hls.Events.BUFFER_FLUSHED, onFlushed);
    }, startLoadForTarget);
    this.flushBuffer(0, Number.POSITIVE_INFINITY);
  }

  // After a flushed reload, a playhead within POST_RELOAD_CLAMP_GAP_S of
  // buffered.start(0) leaves Tizen 2.3 stuck. Nudge it forward once. Startup
  // never arms this (pendingPostReloadClamp is set by flushAndLoad only), so
  // applyPendingStartSeek's snap behaviour is untouched.
  private applyPostReloadClamp(v: HTMLVideoElement): void {
    if (!this.pendingPostReloadClamp || v.buffered.length === 0) return;
    this.pendingPostReloadClamp = false;
    const bStart = v.buffered.start(0);
    const ct = v.currentTime;
    if (ct >= bStart + POST_RELOAD_CLAMP_GAP_S) return;
    const target = bStart + POST_RELOAD_CLAMP_GAP_S;
    this.log.warn('legacySeekFlush clamp gen={gen} ct={ct} bStart={bStart} target={target}', {
      gen: this.seekGen, ct, bStart, target,
    });
    v.currentTime = target;
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
      if (viaFallback) this.log.warn('legacySeekFlush fallback gen={gen} stage={stage}', { gen: this.seekGen, stage });
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
    if (this.cancelStartWarmup) { this.cancelStartWarmup(); this.cancelStartWarmup = null; }
    this.startWarmupArmed = false;
    this.pendingStartSeek = 0;
    if (this.cancelPendingSeek) { this.cancelPendingSeek(); this.cancelPendingSeek = null; }
    super.destroy();
  }

  private applyPendingStartSeek(v: HTMLVideoElement): void {
    if (this.pendingStartSeek <= 0 || v.buffered.length === 0) return;
    // A later FRAG_BUFFERED while the warmup is armed must not re-arm — the
    // resume seek has to run exactly once.
    if (this.startWarmupArmed) return;
    const target = this.pendingStartSeek;
    const bStart = v.buffered.start(0);
    if (v.currentTime < bStart) {
      const ct = v.currentTime;
      v.currentTime = bStart + START_WARMUP_SNAP_OFFSET_S;
      this.log.info('startSeek warmup snap ct={ct} bStart={bStart} target={target}', { ct, bStart, target });
    }
    // Baseline is whatever the playhead reads after the snap: the resume seek
    // must not fire before the decoder has actually advanced from here. The
    // fallback timer covers a device that never starts playing at all.
    this.armStartWarmup(v, target, v.currentTime);
  }

  private armStartWarmup(v: HTMLVideoElement, target: number, baseCt: number): void {
    this.startWarmupArmed = true;
    const startedAt = Date.now();
    let done = false;
    const finish = (reason: StartWarmupReason): void => {
      if (done) return;
      done = true;
      v.removeEventListener('timeupdate', onTimeUpdate);
      window.clearTimeout(timer);
      this.startWarmupArmed = false;
      this.cancelStartWarmup = null;
      this.log.info('startSeek warmup done ct={ct} waited={waited}ms reason={reason}', {
        ct: v.currentTime, waited: Date.now() - startedAt, reason,
      });
      this.runStartSeek(v, target);
    };
    const onTimeUpdate = (): void => {
      if (v.currentTime >= baseCt + START_WARMUP_PROGRESS_S) finish('progress');
    };
    v.addEventListener('timeupdate', onTimeUpdate);
    const timer = window.setTimeout((): void => finish('timeout'), START_WARMUP_FALLBACK_MS);
    this.cancelStartWarmup = (): void => {
      if (done) return;
      done = true;
      v.removeEventListener('timeupdate', onTimeUpdate);
      window.clearTimeout(timer);
    };
  }

  // The resume seek itself — unchanged from the pre-warmup implementation.
  private runStartSeek(v: HTMLVideoElement, target: number): void {
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
