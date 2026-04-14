import { Logger } from '../../utils/log';

export type SeekDirection = 'left' | 'right';

interface SeekDeps {
  readonly getVideoEl: () => HTMLVideoElement | null;
  readonly getDuration: () => number;
  readonly onTick: (dir: SeekDirection) => void;
  readonly onApply: (pos: number) => void;
  readonly log: Logger;
}

const APPLY_DELAY_MS = 2000;
const BASE_STEP_SEC = 10;
const MAX_COUNT_FOR_STEP = 3000;
const END_GUARD_SEC = 2;

export class SeekController {
  private pos = -1;
  private count = 0;
  private dir: SeekDirection | '' = '';
  private active_ = false;
  private applyTimer: number | null = null;

  constructor(private readonly deps: SeekDeps) {}

  get active(): boolean { return this.active_; }
  get position(): number { return this.pos; }

  start(dir: SeekDirection): void {
    this.active_ = true;
    if (this.dir !== dir) { this.dir = dir; this.count = 0; }
    const v = this.deps.getVideoEl();
    if (this.pos === -1 && v) this.pos = v.currentTime;

    const step = BASE_STEP_SEC + Math.pow(Math.min(this.count, MAX_COUNT_FOR_STEP), 3) / 1000;
    const dur = this.deps.getDuration();
    this.pos += dir === 'right' ? step : -step;
    this.pos = Math.max(0, dur > 0 ? Math.min(this.pos, dur - END_GUARD_SEC) : this.pos);
    this.count++;

    if (this.count === 1) {
      this.deps.log.debug('startSeek {dir} seekPos={seekPos} step={step}', { dir, seekPos: this.pos, step });
    }

    this.deps.onTick(dir);

    if (this.applyTimer !== null) clearTimeout(this.applyTimer);
    this.applyTimer = window.setTimeout(() => this.apply(), APPLY_DELAY_MS);
  }

  private apply(): void {
    if (!this.active_ || this.pos < 0 || !this.deps.getVideoEl()) return;
    const dur = this.deps.getDuration();
    if (dur > 0) this.pos = Math.min(this.pos, dur - END_GUARD_SEC);
    this.pos = Math.max(0, this.pos);
    const pos = this.pos;
    this.deps.log.info('applySeek pos={pos} dur={dur}', { pos, dur });
    this.reset();
    this.deps.onApply(pos);
  }

  reset(): void {
    if (this.applyTimer !== null) { clearTimeout(this.applyTimer); this.applyTimer = null; }
    this.pos = -1;
    this.count = 0;
    this.dir = '';
    this.active_ = false;
  }
}
