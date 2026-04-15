// Small declarative finite-state machine runtime.
//
// Shape is close to XState object-literal config: a machine is `{ initial, states }`,
// each state declares `entry`, `exit`, `after` timeout and an `on` event map.
// A transition is either a bare target state name, or `{ target?, cond?, action? }`;
// omitting `target` makes it internal (no exit/entry, just action).
//
// No hierarchy, no parallel, no guards beyond a predicate — deliberately minimal.

export type FsmAction<C, E> = (ctx: C, event: E) => void;

export interface FsmTransition<S extends string, C, E> {
  readonly target?: S;
  readonly cond?: (ctx: C, event: E) => boolean;
  readonly action?: FsmAction<C, E>;
}

export interface FsmStateDef<S extends string, C, E extends { readonly type: string }> {
  readonly entry?: FsmAction<C, E>;
  readonly exit?: FsmAction<C, E>;
  readonly after?: {
    readonly ms: number;
    readonly target: S;
    readonly action?: FsmAction<C, E>;
  };
  readonly on?: {
    readonly [K in E['type']]?: S | FsmTransition<S, C, E>;
  };
}

export interface FsmDef<S extends string, C, E extends { readonly type: string }> {
  readonly initial: S;
  readonly states: { readonly [K in S]: FsmStateDef<S, C, E> };
}

export interface FsmListener<S extends string, E> {
  (state: S, event: E | null): void;
}

const noopEvent = { type: '__init__' } as const;

export class Fsm<S extends string, C, E extends { readonly type: string }> {
  private readonly def: FsmDef<S, C, E>;
  private readonly ctx: C;
  private current: S;
  private afterTimer: number | null = null;
  private listener: FsmListener<S, E> | null = null;
  private stopped = false;

  constructor(def: FsmDef<S, C, E>, ctx: C) {
    this.def = def;
    this.ctx = ctx;
    this.current = def.initial;
    const initState = def.states[this.current];
    if (initState.entry) initState.entry(ctx, noopEvent as unknown as E);
    this.armAfter(initState);
  }

  get state(): S { return this.current; }

  get context(): C { return this.ctx; }

  setListener(cb: FsmListener<S, E> | null): void {
    this.listener = cb;
  }

  send(event: E): void {
    if (this.stopped) return;
    const stateDef = this.def.states[this.current];
    const on = stateDef.on;
    if (!on) return;
    const raw = on[event.type as E['type']];
    if (raw === undefined) return;
    const t: FsmTransition<S, C, E> = typeof raw === 'string'
      ? { target: raw as S }
      : raw as FsmTransition<S, C, E>;
    if (t.cond && !t.cond(this.ctx, event)) return;
    this.applyTransition(t, event, stateDef);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.clearAfter();
    const s = this.def.states[this.current];
    if (s.exit) s.exit(this.ctx, noopEvent as unknown as E);
  }

  private applyTransition(t: FsmTransition<S, C, E>, event: E, fromDef: FsmStateDef<S, C, E>): void {
    const target = t.target;
    // Internal transition: action only, no exit/entry, do not reset after-timer.
    if (target === undefined) {
      if (t.action) t.action(this.ctx, event);
      if (this.listener) this.listener(this.current, event);
      return;
    }
    // External transition: exit → action → entry → rearm after.
    this.clearAfter();
    if (fromDef.exit) fromDef.exit(this.ctx, event);
    if (t.action) t.action(this.ctx, event);
    this.current = target;
    const toDef = this.def.states[target];
    if (toDef.entry) toDef.entry(this.ctx, event);
    this.armAfter(toDef);
    if (this.listener) this.listener(this.current, event);
  }

  private armAfter(stateDef: FsmStateDef<S, C, E>): void {
    if (!stateDef.after) return;
    const { target, action } = stateDef.after;
    this.afterTimer = window.setTimeout(() => {
      this.afterTimer = null;
      if (this.stopped) return;
      const fromDef = this.def.states[this.current];
      this.applyTransition({ target, action }, { type: '__after__' } as unknown as E, fromDef);
    }, stateDef.after.ms);
  }

  private clearAfter(): void {
    if (this.afterTimer !== null) {
      clearTimeout(this.afterTimer);
      this.afterTimer = null;
    }
  }
}
