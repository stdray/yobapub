import { Logger } from '../../utils/log';
import { extractHostname } from '../../utils/url';
import { buildBaseHlsConfig, HlsConfig, logPlaybackStart, getRewrittenHlsUrl } from '../../utils/hls-utils';
import { ProxyCategory, storage } from '../../utils/storage';
import {
  HlsAdapter, HlsError, HlsFragInfo, HlsLevelInfo, createHlsAdapter, isModernHls,
} from './hls-adapter';

interface HlsLoadContext {
  readonly startPosition: number;
  readonly quality: number;
  readonly audio: number;
  readonly sub: number;
  readonly audioIndex: number;
  readonly qualityTarget: { readonly w: number; readonly h: number } | null;
}

interface HlsEngineDeps {
  readonly getVideoEl: () => HTMLVideoElement | null;
  readonly getPlaybackStarted: () => boolean;
  readonly onReady: () => void;
  readonly onFatalError: (err: HlsError) => void;
  readonly log: Logger;
}

const UNRECOVERABLE_MEDIA_ERRORS: ReadonlyArray<string> = [
  'manifestIncompatibleCodecsError',
  'manifestParsingError',
  'levelEmptyError',
];

const ERROR_TYPE_MEDIA = 'mediaError';

export const formatBuffered = (v: HTMLVideoElement | null): string => {
  if (!v || v.buffered.length === 0) return '[none]';
  const parts: string[] = [];
  for (let i = 0; i < v.buffered.length; i++) {
    parts.push(v.buffered.start(i).toFixed(1) + '-' + v.buffered.end(i).toFixed(1));
  }
  return parts.join(',');
};

export class HlsEngine {
  private adapter: HlsAdapter | null = null;
  private hlsUrl_ = '';
  private appendErrorCount = 0;
  private hadBufferFullError = false;
  private firstFragSnapped = false;
  private pendingStartSeek = 0;
  private stallCount = 0;

  constructor(private readonly deps: HlsEngineDeps) {}

  get url(): string { return this.hlsUrl_; }

  getDomain = (): string => extractHostname(this.hlsUrl_);

  getCurrentLevel(): HlsLevelInfo | null {
    const a = this.adapter;
    if (!a || a.currentLevel < 0) return null;
    const levels = a.levels;
    return levels[a.currentLevel] || null;
  }

  getCurrentLevelIndex(): number | null {
    const a = this.adapter;
    return a ? a.currentLevel : null;
  }

  destroy(): void {
    if (this.adapter) { this.adapter.destroy(); this.adapter = null; }
    this.hlsUrl_ = '';
    this.firstFragSnapped = false;
    this.pendingStartSeek = 0;
    this.appendErrorCount = 0;
    this.hadBufferFullError = false;
    this.stallCount = 0;
  }

  load(videoEl: HTMLVideoElement, originalUrl: string, ctx: HlsLoadContext): void {
    this.hlsUrl_ = originalUrl;
    if (this.adapter) { this.adapter.destroy(); this.adapter = null; }
    this.firstFragSnapped = false;
    this.pendingStartSeek = ctx.startPosition > 0 ? ctx.startPosition : 0;
    this.appendErrorCount = 0;
    this.hadBufferFullError = false;
    this.stallCount = 0;

    const log = this.deps.log;

    const cfg = this.buildConfig();
    logPlaybackStart(log, originalUrl, {
      startPosition: cfg.startPosition || 0,
      quality: ctx.quality, audio: ctx.audio, sub: ctx.sub,
    });

    log.info('[hls] version={v} mode={mode} isSupported={s}', {
      v: HlsAdapter.runtimeVersion,
      mode: isModernHls() ? 'modern' : 'legacy',
      s: HlsAdapter.isSupported(),
    });

    const rewrittenUrl = getRewrittenHlsUrl(originalUrl, ctx.audioIndex, ProxyCategory.Media);
    const adapter = createHlsAdapter(cfg);
    this.adapter = adapter;
    this.wireEvents(adapter, ctx.qualityTarget);
    adapter.loadSource(rewrittenUrl);
    adapter.attachMedia(videoEl);
  }

  onVideoSeeking(): void {
    const v = this.deps.getVideoEl();
    if (this.firstFragSnapped || !v || v.buffered.length === 0) return;
    const bStart = v.buffered.start(0);
    if (v.currentTime < bStart && bStart - v.currentTime < 1) {
      this.firstFragSnapped = true;
      const target = bStart + 0.05;
      this.deps.log.info('startupSeekSnap ct={ct} bStart={bStart} -> {target}', {
        ct: v.currentTime, bStart, target,
      });
      v.currentTime = target;
    }
  }

  onVideoCanplay(): void {
    const v = this.deps.getVideoEl();
    if (!v) return;
    if (this.pendingStartSeek !== 0 || this.firstFragSnapped) return;
    if (v.buffered.length === 0 || v.currentTime >= v.buffered.start(0)) return;
    const target = v.buffered.start(0) + 0.05;
    this.firstFragSnapped = true;
    this.deps.log.info('startSeek pts-snap target={target} from ct={ct} br={br}', {
      target, ct: v.currentTime, br: formatBuffered(v),
    });
    v.currentTime = target;
  }

  onVideoPlaying(): void {
    this.appendErrorCount = 0;
    this.hadBufferFullError = false;
    this.stallCount = 0;
  }

  tryRecoverVideoError(): boolean {
    if ((this.appendErrorCount === 0 && !this.hadBufferFullError) || !this.adapter) return false;
    const v = this.deps.getVideoEl();
    if (!v) return false;
    this.deps.log.warn('video error during buffer recovery, stopLoad+startLoad ct={ct}', {
      ct: v.currentTime,
    });
    this.adapter.stopLoad();
    this.adapter.startLoad(v.currentTime);
    if (v.paused) v.play().catch(() => { /* interrupted by load/pause */ });
    this.appendErrorCount = 0;
    this.hadBufferFullError = false;
    return true;
  }

  private buildConfig(): HlsConfig {
    const cfg = buildBaseHlsConfig();
    // Do NOT set cfg.startPosition: hls.js _seekToStartPos fires that seek during decoder
    // warmup on Tizen 2.3 WebKit, which corrupts A/V sync. We start from 0 and perform a
    // manual "user-style" seek on canplay — that path is verified to heal (see decision log
    // 2026-04-13 19:45 and 17:55). Bandwidth cost: one fragment from the beginning.
    cfg.autoStartLoad = false;
    cfg.maxBufferHole = 1.0;
    cfg.highBufferWatchdogPeriod = 10;
    cfg.nudgeMaxRetry = 3;
    cfg.abrEwmaFastLive = 5.0;
    cfg.abrEwmaSlowLive = 10.0;
    // hls.js 0.14.x uses capital-D (see node_modules/hls.js/src/config.ts).
    // Partial<Hls.Config> from @types accepts lowercase variant too — runtime would silently ignore.
    (cfg as unknown as { abrEwmaFastVoD: number }).abrEwmaFastVoD = 5.0;
    (cfg as unknown as { abrEwmaSlowVoD: number }).abrEwmaSlowVoD = 10.0;
    return cfg;
  }

  private pinQualityLevel(adapter: HlsAdapter, target: { readonly w: number; readonly h: number } | null): void {
    const levels = adapter.levels;
    if (levels.length <= 1 || !target) return;

    const preferHevc = storage.getDeviceSettingBool('supportHevc');
    const matchesTarget = (i: number): boolean =>
      levels[i].height === target.h || levels[i].width === target.w;
    const isHevc = (i: number): boolean => /^hvc1|^hev1/i.test(levels[i].videoCodec || '');

    // Two-pass scan: when HEVC is enabled in device settings, first try to
    // find an hvc1/hev1 variant at the target resolution. Fall back to the
    // first matching variant of any codec otherwise.
    let bestIdx = -1;
    if (preferHevc) {
      for (let i = 0; i < levels.length; i++) {
        if (matchesTarget(i) && isHevc(i)) { bestIdx = i; break; }
      }
    }
    if (bestIdx < 0) {
      for (let i = 0; i < levels.length; i++) {
        if (matchesTarget(i)) { bestIdx = i; break; }
      }
    }

    if (bestIdx >= 0) {
      adapter.currentLevel = bestIdx;
      const lvl = levels[bestIdx];
      this.deps.log.info('pinQualityLevel idx={idx} target={w}x{h} level={lw}x{lh} codec={vc} bitrate={br} preferHevc={ph}', {
        idx: bestIdx, w: target.w, h: target.h,
        lw: lvl.width, lh: lvl.height,
        vc: lvl.videoCodec,
        br: lvl.bitrate,
        ph: preferHevc,
      });
    } else {
      this.deps.log.warn('pinQualityLevel: no matching level for {w}x{h}, levels={count}', {
        w: target.w, h: target.h, count: levels.length,
      });
    }
  }

  private nudgePastBufferGap(): boolean {
    const v = this.deps.getVideoEl();
    if (!v || v.buffered.length === 0) return false;
    const ct = v.currentTime;
    for (let i = 0; i < v.buffered.length; i++) {
      const start = v.buffered.start(i);
      if (start > ct && start - ct < 2) {
        this.deps.log.warn('nudgePastBufferGap ct={ct} -> {target}', { ct, target: start + 0.1 });
        v.currentTime = start + 0.1;
        return true;
      }
    }
    this.deps.log.warn('nudgePastBufferGap ct={ct} no suitable range found, buffered={br}', { ct, br: formatBuffered(v) });
    return false;
  }

  private wireEvents(adapter: HlsAdapter, qualityTarget: { readonly w: number; readonly h: number } | null): void {
    const log = this.deps.log;

    adapter.onFragLoading((frag: HlsFragInfo) => {
      log.debug('hls FRAG_LOADING sn={sn} start={start} dur={dur}', {
        sn: frag.sn, start: frag.start, dur: frag.duration,
      });
    });

    adapter.onFragLoaded((p) => {
      const { frag, stats } = p;
      if (stats) {
        const loadMs = stats.tload - stats.trequest;
        const sizeKb = (stats.total / 1024).toFixed(0);
        log.info('hls FRAG_LOADED sn={sn} start={start} dur={dur} size={size}KB load={load}ms', {
          sn: frag.sn, start: frag.start, dur: frag.duration,
          size: sizeKb, load: loadMs,
        });
      }
    });

    adapter.onFragBuffered((frag) => {
      const v = this.deps.getVideoEl();
      log.info('hls FRAG_BUFFERED sn={sn} start={start} type={type} started={started} ct={ct} br={br}', {
        sn: frag.sn, start: frag.start, type: frag.type,
        started: this.deps.getPlaybackStarted(),
        ct: v ? v.currentTime : -1,
        br: formatBuffered(v),
      });
      // Resume: apply pending start seek only once real data is in SourceBuffer so the
      // assignment causes hls.js to stopLoad+startLoad+flush and fetch the target fragment
      // from scratch (decoder-reset path). Seeking before the buffer is populated is
      // indistinguishable from hls.js _seekToStartPos and triggers the Tizen 2.3 A/V desync.
      if (this.pendingStartSeek > 0 && v && v.buffered.length > 0) {
        const target = this.pendingStartSeek;
        this.pendingStartSeek = 0;
        this.firstFragSnapped = true;
        log.info('startSeek target={target} from ct={ct} br={br}', {
          target, ct: v.currentTime, br: formatBuffered(v),
        });
        // Stop loading before seek to prevent hls.js from continuing to fetch
        // the next sequential fragment. After currentTime assignment hls.js
        // will restart loading around the seek target automatically.
        adapter.stopLoad();
        v.currentTime = target;
        adapter.startLoad(target);
        // Drop the [0..firstFragEnd] range left over from sn=1 (see note in
        // buildConfig about startPosition).
        adapter.flushBuffer(0, target - 1);
      }
    });

    adapter.onLevelSwitching((s) => {
      log.info('hls LEVEL_SWITCHING level={level} {w}x{h} bitrate={br} videoCodec={vc} audioCodec={ac}', {
        level: s.level, w: s.width, h: s.height,
        br: s.bitrate, vc: s.videoCodec, ac: s.audioCodec,
      });
    });

    adapter.onLevelSwitched((level) => {
      const levels = adapter.levels;
      const lvl = level !== null && level >= 0 ? levels[level] : undefined;
      log.info('hls LEVEL_SWITCHED level={level} {w}x{h} bitrate={br} videoCodec={vc} audioCodec={ac}', {
        level,
        w: lvl ? lvl.width : null, h: lvl ? lvl.height : null,
        br: lvl ? lvl.bitrate : null, vc: lvl ? lvl.videoCodec : null, ac: lvl ? lvl.audioCodec : null,
      });
    });

    adapter.onManifestLoaded((m) => {
      log.info('hls MANIFEST_LOADED url={url} levels={count}', {
        url: m.url ? m.url.substring(0, 200) : null,
        count: m.levelCount,
      });
    });

    adapter.onLevelLoading((l) => {
      log.info('hls LEVEL_LOADING level={level} url={url}', {
        level: l.level, url: l.url ? l.url.substring(0, 200) : null,
      });
    });

    adapter.onLevelLoaded((l) => {
      log.info('hls LEVEL_LOADED level={level} load={load}ms', {
        level: l.levelId, load: l.loadMs,
      });
    });

    adapter.onManifestParsed(() => {
      const lvls = adapter.levels;
      log.info('hls MANIFEST_PARSED levels={count} details={details}', {
        count: lvls.length,
        details: lvls.map((l) =>
          l.width + 'x' + l.height + '@' + l.bitrate
          + ' vc=' + (l.videoCodec || '?') + ' ac=' + (l.audioCodec || '?'),
        ).join(', '),
      });
      this.pinQualityLevel(adapter, qualityTarget);
      // autoStartLoad is disabled in config — start loading only after pin to avoid
      // hls.js kicking off a load on level 0/auto and then switching (double LEVEL_SWITCHING).
      // Always load from the beginning; real start position is applied as a runtime seek in canplay.
      adapter.startLoad(0);
      this.deps.onReady();
    });

    adapter.onError((err) => {
      if (!err.fatal) {
        this.handleNonFatalError(adapter, err);
        return;
      }
      this.handleFatalError(adapter, err);
    });
  }

  private handleNonFatalError(adapter: HlsAdapter, err: HlsError): void {
    const log = this.deps.log;
    log.warn('hls error (non-fatal) {type} {details} {message} {url}', {
      type: err.type, details: err.details,
      message: err.message,
      url: err.url ? err.url.substring(0, 120) : null,
    });
    const v = this.deps.getVideoEl();
    const diag = {
      started: this.deps.getPlaybackStarted(),
      ct: v ? v.currentTime : -1,
      rs: v ? v.readyState : -1,
      paused: v ? v.paused : null,
      br: formatBuffered(v),
    };
    if (err.details === 'bufferFullError') {
      this.hadBufferFullError = true;
      log.warn('hls bufferFullError flagged started={started} ct={ct} rs={rs} br={br}', diag);
    }
    if (err.details === 'bufferAppendingError') {
      this.appendErrorCount++;
      log.warn('hls bufferAppendingError count={count} hadFull={hadFull} started={started} ct={ct} rs={rs} br={br}', {
        count: this.appendErrorCount,
        hadFull: this.hadBufferFullError,
        started: diag.started, ct: diag.ct, rs: diag.rs, paused: diag.paused, br: diag.br,
      });
      if ((this.appendErrorCount >= 2 || this.hadBufferFullError) && v) {
        log.warn('hls RECOVER via bufferAppendingError stopLoad+startLoad ct={ct} br={br}', diag);
        adapter.stopLoad();
        adapter.startLoad(v.currentTime);
        if (v.paused) v.play().catch(() => { /* interrupted by load/pause */ });
        this.appendErrorCount = 0;
        this.hadBufferFullError = false;
      }
    }
    if (err.details === 'bufferStalledError') {
      this.stallCount++;
      log.warn('hls bufferStalledError hadFull={hadFull} started={started} ct={ct} rs={rs} br={br} stallCount={sc}', {
        hadFull: this.hadBufferFullError,
        started: diag.started, ct: diag.ct, rs: diag.rs, paused: diag.paused, br: diag.br,
        sc: this.stallCount,
      });
      if (this.nudgePastBufferGap()) return;
      // Do NOT use recoverMediaError() for stalls — on Tizen 2.3/3.0 it resets
      // currentTime to 0 and leaves playback dead. Instead, force hls.js to
      // re-fetch fragments from the current position via stopLoad+startLoad.
      const threshold = this.hadBufferFullError ? 2 : 3;
      if (this.stallCount >= threshold && v) {
        log.warn('hls RECOVER via stallCount={sc} stopLoad+startLoad ct={ct} br={br} hadFull={hadFull}', {
          sc: this.stallCount, ct: diag.ct, br: diag.br, hadFull: this.hadBufferFullError,
        });
        adapter.stopLoad();
        adapter.startLoad(v.currentTime);
        this.stallCount = 0;
        this.hadBufferFullError = false;
        this.appendErrorCount = 0;
      }
    }
  }

  private handleFatalError(adapter: HlsAdapter, err: HlsError): void {
    const log = this.deps.log;
    log.error('hls fatal {type} {details} {status} currentLevel={currentLevel} message={message}', {
      type: err.type, details: err.details,
      status: err.httpStatus,
      currentLevel: adapter.currentLevel,
      message: err.message,
    });
    // Unrecoverable MEDIA_ERROR details — manifest-level codec mismatches cannot be
    // fixed by recoverMediaError(), which only handles decoder/buffer issues at runtime.
    if (err.type === ERROR_TYPE_MEDIA && UNRECOVERABLE_MEDIA_ERRORS.indexOf(err.details) < 0) {
      const vf = this.deps.getVideoEl();
      log.warn('hls RECOVER fatal MEDIA_ERROR started={started} ct={ct} rs={rs} br={br}', {
        started: this.deps.getPlaybackStarted(),
        ct: vf ? vf.currentTime : -1,
        rs: vf ? vf.readyState : -1,
        br: formatBuffered(vf),
      });
      adapter.recoverMediaError();
      return;
    }
    this.deps.onFatalError(err);
  }
}
