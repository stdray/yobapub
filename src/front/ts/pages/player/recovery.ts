// Controlled buffering recovery — shared by the automatic stall path
// (Feature A) and the manual re-sync remote key (Feature B).
//
// The routine flushes the SourceBuffer and re-appends from the current time
// (out-of-buffer reload), which resets the decoder. This is the ONLY reliable
// heal for the Tizen 2.3 audio-decoder wedge — an in-buffer `currentTime += 0.1`
// nudge is proven to cause A/V desync (decision log 2026-04-13), and
// hls.js `recoverMediaError()` resets currentTime to 0 and wedges the player.
//
// "Stable" is gated on the video clock ACTUALLY advancing across two timeupdate
// ticks while the current time sits inside a buffered range — readyState/canplay
// are unreliable on Tizen 2.3 and must not be trusted as a readiness signal.

import { Logger } from '../../utils/log';
import { safePlay } from '../../utils/hls-utils';
import { HlsEngine } from './hls-engine';

export type RecoveryReason = 'stall' | 'manual';

// Named constants — no magic numbers.
const RECOVERY_TIMEOUT_MS = 15000;
const STABLE_TICKS = 2;
const CT_ADVANCE_EPSILON = 0.02;

interface RecoveryDeps {
  readonly getVideoEl: () => HTMLVideoElement | null;
  readonly engine: HlsEngine;
  readonly onStable: () => void;
  readonly onTimeout: () => void;
  readonly log: Logger;
}

const bufferedCovers = (v: HTMLVideoElement, t: number): boolean => {
  for (let i = 0; i < v.buffered.length; i++) {
    if (v.buffered.start(i) <= t && t <= v.buffered.end(i)) return true;
  }
  return false;
};

export class ControlledRecovery {
  private active = false;
  private timer: number | null = null;
  private ticks = 0;
  private lastCt = 0;
  private videoEl: HTMLVideoElement | null = null;

  constructor(private readonly deps: RecoveryDeps) {}

  get running(): boolean { return this.active; }

  // Kick off a controlled recovery. Returns false if one is already running or
  // there is no video element to recover.
  start(reason: RecoveryReason): boolean {
    if (this.active) return false;
    const v = this.deps.getVideoEl();
    if (!v) return false;
    const ct = v.currentTime;
    this.active = true;
    this.videoEl = v;
    this.lastCt = ct;
    this.ticks = 0;
    this.deps.log.warn('controlled recovery start reason={reason} ct={ct}', { reason, ct });
    // Tizen: play() on a stalled non-paused element is a no-op — pause() first to
    // un-wedge it. Then flush + re-append from ct to reset the decoder, and resume
    // so the video clock advances and the stability watcher can observe it.
    v.pause();
    this.deps.engine.controlledReload(ct);
    safePlay(v);
    v.addEventListener('timeupdate', this.onTick);
    this.timer = window.setTimeout(() => this.finish(false), RECOVERY_TIMEOUT_MS);
    return true;
  }

  cancel(): void {
    if (!this.active) return;
    this.deps.log.info('controlled recovery cancelled');
    this.teardown();
  }

  private readonly onTick = (): void => {
    const v = this.videoEl;
    if (!v) return;
    const ct = v.currentTime;
    const advanced = ct > this.lastCt + CT_ADVANCE_EPSILON;
    this.lastCt = ct;
    if (advanced && bufferedCovers(v, ct)) {
      this.ticks++;
      if (this.ticks >= STABLE_TICKS) this.finish(true);
    } else {
      this.ticks = 0;
    }
  };

  private finish(stable: boolean): void {
    const v = this.videoEl;
    this.teardown();
    if (stable) {
      this.deps.log.info('controlled recovery stable');
      if (v && v.paused) safePlay(v);
      this.deps.onStable();
    } else {
      this.deps.log.error('controlled recovery timeout ms={ms}', { ms: RECOVERY_TIMEOUT_MS });
      this.deps.onTimeout();
    }
  }

  private teardown(): void {
    this.active = false;
    this.ticks = 0;
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    if (this.videoEl) this.videoEl.removeEventListener('timeupdate', this.onTick);
    this.videoEl = null;
  }
}
