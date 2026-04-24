import { markTime, toggleWatched } from "../../api/watching";
import { Logger } from "../../utils/log";

interface WatchContext {
  readonly itemId: number;
  readonly season: number | undefined;
  readonly episode: number | undefined;
  readonly video: number | undefined;
}

interface DroppedFrames {
  readonly total: number;
  readonly dropped: number;
}

interface WatchTrackerDeps {
  readonly getVideoEl: () => HTMLVideoElement | null;
  readonly getContext: () => WatchContext | null;
  readonly getDuration: () => number;
  readonly getDroppedFrames: () => DroppedFrames | null;
  readonly log: Logger;
}

const TICK_MS = 30000;
const WAS_WATCHED_TICKS = 3;
const SERIAL_END_THRESHOLD_SEC = 95;
const MOVIE_END_THRESHOLD_SEC = 240;

export class WatchProgressTracker {
  private timer: number | null = null;
  private marked = false;
  private wasWatched = false;
  private wasWatchedTicks = 0;
  private lastSentTime = -1;
  private staleTicks = 0;

  constructor(private readonly deps: WatchTrackerDeps) {}

  get markedWatched(): boolean { return this.marked; }

  setWasWatched = (v: boolean): void => {
    this.wasWatched = v;
  };

  start(): void {
    this.stop();
    this.marked = false;
    this.wasWatchedTicks = 0;
    this.lastSentTime = -1;
    this.staleTicks = 0;
    this.deps.log.info("startMarkTimer interval={ms}", { ms: TICK_MS });
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      this.deps.log.info("stopMarkTimer", {});
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  sendMarkTime(): void {
    const v = this.deps.getVideoEl();
    const ctx = this.deps.getContext();
    const log = this.deps.log;
    if (this.marked) {
      log.info("sendMarkTime skip (already marked watched)", {});
      return;
    }
    if (!v || !ctx) {
      log.warn("sendMarkTime skip hasVideo={hv} hasItem={hi}", {
        hv: !!v,
        hi: !!ctx,
      });
      return;
    }
    const time = Math.floor(v.currentTime);
    if (time <= 0) {
      log.warn("sendMarkTime skip time<=0 ct={ct}", { ct: v.currentTime });
      return;
    }
    if (time === this.lastSentTime) return;
    this.lastSentTime = time;
    let promise: JQueryDeferred<void>;
    if (ctx.season !== undefined && ctx.episode !== undefined) {
      log.info("sendMarkTime serial id={id} season={s} episode={e} time={t}", {
        id: ctx.itemId,
        s: ctx.season,
        e: ctx.episode,
        t: time,
      });
      promise = markTime(ctx.itemId, ctx.episode, time, ctx.season);
    } else if (ctx.video !== undefined) {
      log.info("sendMarkTime movie id={id} video={v} time={t}", {
        id: ctx.itemId,
        v: ctx.video,
        t: time,
      });
      promise = markTime(ctx.itemId, ctx.video, time);
    } else {
      log.warn("sendMarkTime skip no season/episode/video", {});
      return;
    }
    promise.then(
      (res: unknown) =>
        log.info("markTime resp id={id} time={t} body={b}", {
          id: ctx.itemId,
          t: time,
          b: JSON.stringify(res).substring(0, 300),
        }),
      (xhr: JQueryXHR) =>
        log.error("markTime failed status={s} text={txt} resp={r}", {
          s: xhr ? xhr.status : -1,
          txt: xhr ? String(xhr.statusText || "") : "",
          r: xhr ? String(xhr.responseText || "").substring(0, 200) : "",
        }),
    );
  }

  markWatched(onFail?: () => void): void {
    if (this.marked) return;
    this.marked = true;
    this.deps.log.info("markWatched", {});
    this.sendToggleWatched(() => {
      this.marked = false;
      if (onFail) onFail();
    });
  }

  sendToggleWatched(onFail?: () => void): void {
    const ctx = this.deps.getContext();
    const log = this.deps.log;
    if (!ctx) {
      log.warn("sendToggleWatched skip no ctx", {});
      if (onFail) onFail();
      return;
    }
    let promise: JQueryDeferred<void>;
    if (ctx.season !== undefined && ctx.episode !== undefined) {
      log.info("sendToggleWatched serial id={id} season={s} episode={e}", {
        id: ctx.itemId, s: ctx.season, e: ctx.episode,
      });
      promise = toggleWatched(ctx.itemId, ctx.episode, ctx.season);
    } else if (ctx.video !== undefined) {
      log.info("sendToggleWatched movie id={id} video={v}", {
        id: ctx.itemId, v: ctx.video,
      });
      promise = toggleWatched(ctx.itemId, ctx.video);
    } else {
      log.warn("sendToggleWatched skip no season/episode/video", {});
      if (onFail) onFail();
      return;
    }
    promise.then(
      (res: unknown) =>
        log.info("toggleWatched resp id={id} body={b}", {
          id: ctx.itemId,
          b: JSON.stringify(res).substring(0, 300),
        }),
      (xhr: JQueryXHR) => {
        log.error("toggleWatched failed status={s} text={txt} resp={r}", {
          s: xhr ? xhr.status : -1,
          txt: xhr ? String(xhr.statusText || "") : "",
          r: xhr ? String(xhr.responseText || "").substring(0, 200) : "",
        });
        if (onFail) onFail();
      },
    );
  }

  private tick(): void {
    const vel = this.deps.getVideoEl();
    const ct = vel ? vel.currentTime : 0;
    if (ct <= 0) {
      this.staleTicks++;
      if (this.staleTicks >= 3) {
        this.deps.log.warn("markTimer stopped after {n} stale ticks (ct=0)", {
          n: this.staleTicks,
        });
        this.stop();
        return;
      }
    } else {
      this.staleTicks = 0;
    }
    this.deps.log.info("markTimer tick", {});
    this.sendMarkTime();
    this.logPlaybackQuality();

    if (this.wasWatched) {
      this.wasWatchedTicks++;
      if (this.wasWatchedTicks >= WAS_WATCHED_TICKS) {
        this.wasWatched = false;
        this.deps.log.info("resetting watched status after {sec}s of playback", {
          sec: WAS_WATCHED_TICKS * TICK_MS / 1000,
        });
        this.sendToggleWatched();
      }
    }

    if (this.marked) return;
    const dur = this.deps.getDuration();
    if (dur <= 0) return;
    const v = this.deps.getVideoEl();
    const time = v ? Math.floor(v.currentTime) : 0;
    const ctx = this.deps.getContext();
    const threshold =
      ctx && ctx.season !== undefined
        ? SERIAL_END_THRESHOLD_SEC
        : MOVIE_END_THRESHOLD_SEC;
    if (dur - time <= threshold) {
      this.markWatched();
    }
  }

  private logPlaybackQuality(): void {
    const q = this.deps.getDroppedFrames();
    if (!q || q.total === 0) return;
    const pct = ((q.dropped / q.total) * 100).toFixed(1);
    this.deps.log.info(
      "playbackQuality total={total} dropped={dropped} ({pct}%)",
      {
        total: q.total,
        dropped: q.dropped,
        pct,
      },
    );
  }
}
