import Hls from 'hls.js';
import { Logger } from '../../utils/log';
import { extractHostname } from '../../utils/url';
import { buildBaseHlsConfig, HlsConfig, logPlaybackStart, getRewrittenHlsUrl } from '../../utils/hls-utils';
import { ProxyCategory } from '../../utils/storage';

interface HlsFragData {
  frag?: { sn: number; start: number; duration: number };
  stats?: { total: number; trequest: number; tfirst: number; tload: number };
}

interface HlsLevelSwitchData {
  level?: number;
  width?: number;
  height?: number;
  bitrate?: number;
  videoCodec?: string;
  audioCodec?: string;
}

export interface HlsFatalErrorData {
  readonly fatal: boolean;
  readonly type: string;
  readonly details: string;
  readonly reason?: string;
  readonly error?: unknown;
  readonly response?: { code: number };
  readonly frag?: { url?: string; sn?: number; start?: number };
}

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
  readonly onFatalError: (data: HlsFatalErrorData) => void;
  readonly log: Logger;
}

const UNRECOVERABLE_MEDIA_ERRORS: ReadonlyArray<string> = [
  'manifestIncompatibleCodecsError',
  'manifestParsingError',
  'levelEmptyError',
];

export const formatBuffered = (v: HTMLVideoElement | null): string => {
  if (!v || v.buffered.length === 0) return '[none]';
  const parts: string[] = [];
  for (let i = 0; i < v.buffered.length; i++) {
    parts.push(v.buffered.start(i).toFixed(1) + '-' + v.buffered.end(i).toFixed(1));
  }
  return parts.join(',');
};

export class HlsEngine {
  private hls: Hls | null = null;
  private hlsUrl_ = '';
  private appendErrorCount = 0;
  private hadBufferFullError = false;
  private firstFragSnapped = false;
  private pendingStartSeek = 0;
  private stallCount = 0;

  constructor(private readonly deps: HlsEngineDeps) {}

  get instance(): Hls | null { return this.hls; }
  get url(): string { return this.hlsUrl_; }

  getDomain = (): string => extractHostname(this.hlsUrl_);

  getCurrentLevel(): Hls.Level | undefined {
    const h = this.hls;
    if (!h || h.currentLevel < 0 || !h.levels) return undefined;
    return h.levels[h.currentLevel];
  }

  destroy(): void {
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    this.hlsUrl_ = '';
    this.firstFragSnapped = false;
    this.pendingStartSeek = 0;
    this.appendErrorCount = 0;
    this.hadBufferFullError = false;
    this.stallCount = 0;
  }

  load(videoEl: HTMLVideoElement, originalUrl: string, ctx: HlsLoadContext): void {
    this.hlsUrl_ = originalUrl;
    if (this.hls) { this.hls.destroy(); this.hls = null; }
    this.firstFragSnapped = false;
    this.pendingStartSeek = ctx.startPosition > 0 ? ctx.startPosition : 0;
    this.appendErrorCount = 0;
    this.hadBufferFullError = false;
    this.stallCount = 0;

    const log = this.deps.log;
    log.newTraceId();

    const cfg = this.buildConfig();
    logPlaybackStart(log, originalUrl, {
      startPosition: cfg.startPosition || 0,
      quality: ctx.quality, audio: ctx.audio, sub: ctx.sub,
    });

    const rewrittenUrl = getRewrittenHlsUrl(originalUrl, ctx.audioIndex, ProxyCategory.Media);
    const hls = new Hls(cfg);
    this.hls = hls;
    this.wireEvents(hls, ctx.qualityTarget);
    hls.loadSource(rewrittenUrl);
    hls.attachMedia(videoEl);
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
    if ((this.appendErrorCount === 0 && !this.hadBufferFullError) || !this.hls) return false;
    const v = this.deps.getVideoEl();
    if (!v) return false;
    this.deps.log.warn('video error during buffer recovery, stopLoad+startLoad ct={ct}', {
      ct: v.currentTime,
    });
    this.hls.stopLoad();
    this.hls.startLoad(v.currentTime);
    if (v.paused) v.play();
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

  private pinQualityLevel(hls: Hls, target: { readonly w: number; readonly h: number } | null): void {
    const levels = hls.levels;
    if (!levels || levels.length <= 1 || !target) return;

    let bestIdx = -1;
    for (let i = 0; i < levels.length; i++) {
      if (levels[i].height === target.h || levels[i].width === target.w) {
        bestIdx = i;
        break;
      }
    }

    if (bestIdx >= 0) {
      hls.currentLevel = bestIdx;
      this.deps.log.info('pinQualityLevel idx={idx} target={w}x{h} level={lw}x{lh} bitrate={br}', {
        idx: bestIdx, w: target.w, h: target.h,
        lw: levels[bestIdx].width, lh: levels[bestIdx].height,
        br: levels[bestIdx].bitrate,
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

  private wireEvents(hls: Hls, qualityTarget: { readonly w: number; readonly h: number } | null): void {
    const log = this.deps.log;

    hls.on(Hls.Events.FRAG_LOADING, (_e: string, data: { frag?: { sn: number; start: number; duration: number } }) => {
      const frag = data.frag;
      if (frag) {
        log.debug('hls FRAG_LOADING sn={sn} start={start} dur={dur}', {
          sn: frag.sn, start: frag.start, dur: frag.duration,
        });
      }
    });

    hls.on(Hls.Events.FRAG_LOADED, (_e: string, data: HlsFragData) => {
      const frag = data.frag;
      const stats = data.stats;
      if (frag && stats) {
        const loadMs = stats.tload - stats.trequest;
        const sizeKb = (stats.total / 1024).toFixed(0);
        log.info('hls FRAG_LOADED sn={sn} start={start} dur={dur} size={size}KB load={load}ms', {
          sn: frag.sn, start: frag.start, dur: frag.duration,
          size: sizeKb, load: loadMs,
        });
      }
    });

    hls.on(Hls.Events.FRAG_BUFFERED, (_e: string, data: { frag?: { sn: number; start: number; type?: string } }) => {
      const frag = data.frag;
      if (!frag) return;
      const v = this.deps.getVideoEl();
      log.info('hls FRAG_BUFFERED sn={sn} start={start} type={type} started={started} ct={ct} br={br}', {
        sn: frag.sn, start: frag.start, type: frag.type || null,
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
        // the next sequential fragment (e.g. sn=2) which would waste bandwidth.
        // After currentTime assignment hls.js will restart loading around the
        // seek target automatically.
        hls.stopLoad();
        v.currentTime = target;
        hls.startLoad(target);
      }
    });

    hls.on(Hls.Events.LEVEL_SWITCHING, (_e: string, data: HlsLevelSwitchData) => {
      log.info('hls LEVEL_SWITCHING level={level} {w}x{h} bitrate={br} videoCodec={vc} audioCodec={ac}', {
        level: data.level, w: data.width, h: data.height,
        br: data.bitrate, vc: data.videoCodec || null, ac: data.audioCodec || null,
      });
    });

    hls.on(Hls.Events.LEVEL_SWITCHED, (_e: string, data: { level?: number }) => {
      const lvl = data.level !== undefined ? hls.levels[data.level] : undefined;
      log.info('hls LEVEL_SWITCHED level={level} {w}x{h} bitrate={br} videoCodec={vc} audioCodec={ac}', {
        level: data.level,
        w: lvl ? lvl.width : null, h: lvl ? lvl.height : null,
        br: lvl ? lvl.bitrate : null, vc: lvl ? lvl.videoCodec || null : null, ac: lvl ? lvl.audioCodec || null : null,
      });
    });

    hls.on(Hls.Events.MANIFEST_LOADED, (_e, data) => {
      log.info('hls MANIFEST_LOADED url={url} levels={count}', {
        url: data.url ? data.url.substring(0, 200) : null,
        count: data.levels ? data.levels.length : 0,
      });
    });

    hls.on(Hls.Events.LEVEL_LOADING, (_e, data) => {
      log.info('hls LEVEL_LOADING level={level} url={url}', {
        level: data.level, url: data.url ? data.url.substring(0, 200) : null,
      });
    });

    hls.on(Hls.Events.LEVEL_LOADED, (_e, data) => {
      const loadMs = data.stats ? data.stats.tload - data.stats.trequest : null;
      log.info('hls LEVEL_LOADED level={level} load={load}ms', {
        level: data.levelId, load: loadMs,
      });
    });

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      const lvls = hls.levels;
      log.info('hls MANIFEST_PARSED levels={count} details={details}', {
        count: lvls.length,
        details: lvls.map((l) =>
          l.width + 'x' + l.height + '@' + l.bitrate
          + ' vc=' + (l.videoCodec || '?') + ' ac=' + (l.audioCodec || '?'),
        ).join(', '),
      });
      this.pinQualityLevel(hls, qualityTarget);
      // autoStartLoad is disabled in config — start loading only after pin to avoid
      // hls.js kicking off a load on level 0/auto and then switching (double LEVEL_SWITCHING).
      // Always load from the beginning; real start position is applied as a runtime seek in canplay.
      hls.startLoad(0);
      this.deps.onReady();
    });

    hls.on(Hls.Events.ERROR, (_e: string, data: HlsFatalErrorData) => {
      if (!data.fatal) {
        this.handleNonFatalError(hls, data);
        return;
      }
      this.handleFatalError(hls, data);
    });
  }

  private handleNonFatalError(hls: Hls, data: HlsFatalErrorData): void {
    const log = this.deps.log;
    log.warn('hls error (non-fatal) {type} {details} {reason} {error} {fragUrl}', {
      type: data.type, details: data.details,
      reason: data.reason || null,
      error: data.error ? String(data.error).substring(0, 200) : null,
      fragUrl: data.frag ? (data.frag.url || '').substring(0, 120) : null,
      fragSn: data.frag ? data.frag.sn : null,
      fragStart: data.frag ? data.frag.start : null,
    });
    const v = this.deps.getVideoEl();
    const diag = {
      started: this.deps.getPlaybackStarted(),
      ct: v ? v.currentTime : -1,
      rs: v ? v.readyState : -1,
      paused: v ? v.paused : null,
      br: formatBuffered(v),
    };
    if (data.details === 'bufferFullError') {
      this.hadBufferFullError = true;
      log.warn('hls bufferFullError flagged started={started} ct={ct} rs={rs} br={br}', diag);
    }
    if (data.details === 'bufferAppendingError') {
      this.appendErrorCount++;
      log.warn('hls bufferAppendingError count={count} hadFull={hadFull} started={started} ct={ct} rs={rs} br={br}', {
        count: this.appendErrorCount,
        hadFull: this.hadBufferFullError,
        started: diag.started, ct: diag.ct, rs: diag.rs, paused: diag.paused, br: diag.br,
      });
      if ((this.appendErrorCount >= 2 || this.hadBufferFullError) && v) {
        log.warn('hls RECOVER via bufferAppendingError stopLoad+startLoad ct={ct} br={br}', diag);
        hls.stopLoad();
        hls.startLoad(v.currentTime);
        if (v.paused) v.play();
        this.appendErrorCount = 0;
        this.hadBufferFullError = false;
      }
    }
    if (data.details === 'bufferStalledError') {
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
      // Use threshold 2 when hadBufferFullError (fragments likely evicted
      // immediately), 3 otherwise.
      const threshold = this.hadBufferFullError ? 2 : 3;
      if (this.stallCount >= threshold && v) {
        log.warn('hls RECOVER via stallCount={sc} stopLoad+startLoad ct={ct} br={br} hadFull={hadFull}', {
          sc: this.stallCount, ct: diag.ct, br: diag.br, hadFull: this.hadBufferFullError,
        });
        hls.stopLoad();
        hls.startLoad(v.currentTime);
        this.stallCount = 0;
        this.hadBufferFullError = false;
        this.appendErrorCount = 0;
      }
    }
  }

  private handleFatalError(hls: Hls, data: HlsFatalErrorData): void {
    const log = this.deps.log;
    const hlsFatalLvl = (hls as unknown as { readonly currentLevel?: number }).currentLevel;
    log.error('hls fatal {type} {details} {status} currentLevel={currentLevel}', {
      type: data.type, details: data.details,
      status: data.response ? data.response.code : null,
      currentLevel: hlsFatalLvl !== undefined ? hlsFatalLvl : null,
      reason: data.reason || null,
      error: data.error ? String(data.error).substring(0, 200) : null,
    });
    // Unrecoverable MEDIA_ERROR details — manifest-level codec mismatches cannot be
    // fixed by recoverMediaError(), which only handles decoder/buffer issues at runtime.
    // Calling recover here would just leave the spinner spinning forever.
    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && UNRECOVERABLE_MEDIA_ERRORS.indexOf(data.details) < 0) {
      const vf = this.deps.getVideoEl();
      log.warn('hls RECOVER fatal MEDIA_ERROR started={started} ct={ct} rs={rs} br={br}', {
        started: this.deps.getPlaybackStarted(),
        ct: vf ? vf.currentTime : -1,
        rs: vf ? vf.readyState : -1,
        br: formatBuffered(vf),
      });
      hls.recoverMediaError();
      return;
    }
    this.deps.onFatalError(data);
  }
}
