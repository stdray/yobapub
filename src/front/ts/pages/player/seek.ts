import { Logger } from '../../utils/log';

export type SeekDirection = 'left' | 'right';

interface SeekDeps {
  readonly getVideoEl: () => HTMLVideoElement | null;
  readonly getDuration: () => number;
  readonly log: Logger;
}

const BASE_STEP_SEC = 10;
const MAX_COUNT_FOR_STEP = 3000;
const END_GUARD_SEC = 2;

// Pure stateful seek accumulator — no timers, no side-effects.
// The player FSM drives begin/step/commit/cancel.
export class SeekController {
  private pos = -1;
  private count = 0;
  private dir: SeekDirection | '' = '';

  constructor(private readonly deps: SeekDeps) {}

  get active(): boolean { return this.pos >= 0; }
  get position(): number { return this.pos; }

  begin(): void {
    const v = this.deps.getVideoEl();
    this.pos = v ? v.currentTime : 0;
    this.count = 0;
    this.dir = '';
    this.deps.log.debug('seek begin pos={pos}', { pos: this.pos });
  }

  step(dir: SeekDirection): void {
    if (this.pos < 0) this.begin();
    if (this.dir !== dir) { this.dir = dir; this.count = 0; }
    const step = BASE_STEP_SEC + Math.pow(Math.min(this.count, MAX_COUNT_FOR_STEP), 3) / 1000;
    const dur = this.deps.getDuration();
    this.pos += dir === 'right' ? step : -step;
    this.pos = Math.max(0, dur > 0 ? Math.min(this.pos, dur - END_GUARD_SEC) : this.pos);
    this.count++;
  }

  commit(): number {
    if (this.pos < 0) return -1;
    const dur = this.deps.getDuration();
    if (dur > 0) this.pos = Math.min(this.pos, dur - END_GUARD_SEC);
    this.pos = Math.max(0, this.pos);
    const pos = this.pos;
    this.deps.log.info('seek commit pos={pos} dur={dur}', { pos, dur });
    this.reset();
    return pos;
  }

  reset(): void {
    this.pos = -1;
    this.count = 0;
    this.dir = '';
  }
}
