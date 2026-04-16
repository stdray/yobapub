// Declarative state machine for the player UI.
//
// States, events and side-effects are wired here; the runtime lives in
// `utils/fsm.ts`. The context (`PlayerFsmCtx`) is a facade implemented by
// `PlayerController` — the machine never touches the DOM directly.

import { FsmDef } from '../../utils/fsm';

export type PlayerState =
  | 'loading'
  | 'idle'
  | 'seekFocus'
  | 'seeking'
  | 'buttonsFocus'
  | 'sidePanelOpen'
  | 'error';

export type PlayerEvent =
  | { readonly type: 'KEY_UP' }
  | { readonly type: 'KEY_DOWN' }
  | { readonly type: 'KEY_LEFT' }
  | { readonly type: 'KEY_RIGHT' }
  | { readonly type: 'KEY_ENTER' }
  | { readonly type: 'KEY_BACK' }
  | { readonly type: 'KEY_PLAY_PAUSE' }
  | { readonly type: 'KEY_PLAY' }
  | { readonly type: 'KEY_PAUSE' }
  | { readonly type: 'SOURCE_READY' }
  | { readonly type: 'BUFFERING' }
  | { readonly type: 'FATAL_ERROR' };

// Side-effects the machine can request. PlayerController implements this.
export interface PlayerFsmCtx {
  // --- spinner / bar / error ---
  showSpinner(): void;
  hideSpinner(): void;
  showBar(): void;
  hideBar(): void;
  showError(): void;
  setProgressActive(active: boolean): void;

  // --- playback ---
  togglePlay(): void;
  play(): void;
  pause(): void;
  exit(): void;

  // --- panel (action buttons) ---
  focusPanelButtons(): void;
  unfocusPanelButtons(): void;
  panelPrevBtn(): void;
  panelNextBtn(): void;
  isCurrentPanelBtnEnabled(): boolean;
  isCurrentPanelBtnInstant(): boolean;
  applyInstantPanelBtn(): void;

  // --- mode memory ---
  markSeekClosed(): void;
  markButtonsClosed(): void;
  wasLastModeButtons(): boolean;

  // --- side panel (options list) ---
  openSidePanel(): void;
  closeSidePanel(): void;
  sideListPrev(): void;
  sideListNext(): void;
  applySideSelection(): void;

  // --- seeking ---
  seekBegin(): void;
  seekStep(dir: -1 | 1): void;
  seekCommit(): void;
  seekCancel(): void;
}

const UI_IDLE_MS = 8000;
const SEEK_COMMIT_MS = 2000;

export const playerMachine: FsmDef<PlayerState, PlayerFsmCtx, PlayerEvent> = {
  initial: 'loading',
  states: {

    loading: {
      entry: (c) => c.showSpinner(),
      exit:  (c) => c.hideSpinner(),
      on: {
        SOURCE_READY: 'idle',
        FATAL_ERROR:  'error',
        KEY_BACK:     { action: (c) => c.exit() },
      },
    },

    idle: {
      entry: (c) => c.hideBar(),
      on: {
        KEY_UP: [
          { cond: (c) => c.wasLastModeButtons(), target: 'buttonsFocus' },
          { target: 'seekFocus' },
        ],
        KEY_LEFT:       'seeking',
        KEY_RIGHT:      'seeking',
        KEY_PLAY_PAUSE: { target: 'seekFocus', action: (c) => c.togglePlay() },
        KEY_PLAY:       { target: 'seekFocus', action: (c) => c.play() },
        KEY_PAUSE:      { target: 'seekFocus', action: (c) => c.pause() },
        KEY_ENTER:      { target: 'seekFocus', action: (c) => c.togglePlay() },
        BUFFERING:      'loading',
        FATAL_ERROR:    'error',
        KEY_BACK:       { action: (c) => c.exit() },
      },
    },

    seekFocus: {
      entry: (c) => { c.showBar(); c.setProgressActive(true); },
      after: { ms: UI_IDLE_MS, target: 'idle', action: (c) => c.markSeekClosed() },
      on: {
        KEY_UP:         'buttonsFocus',
        KEY_DOWN:       { target: 'idle', action: (c) => c.markSeekClosed() },
        KEY_LEFT:       'seeking',
        KEY_RIGHT:      'seeking',
        KEY_PLAY_PAUSE: { target: 'seekFocus', action: (c) => c.togglePlay() },
        KEY_PLAY:       { target: 'seekFocus', action: (c) => c.play() },
        KEY_PAUSE:      { target: 'seekFocus', action: (c) => c.pause() },
        KEY_ENTER:      { target: 'seekFocus', action: (c) => c.togglePlay() },
        KEY_BACK:       { target: 'idle', action: (c) => c.markSeekClosed() },
        BUFFERING:      'loading',
        FATAL_ERROR:    'error',
      },
    },

    seeking: {
      entry: (c) => { c.showBar(); c.setProgressActive(true); c.seekBegin(); },
      after: {
        ms: SEEK_COMMIT_MS,
        target: 'seekFocus',
        action: (c) => c.seekCommit(),
      },
      on: {
        KEY_LEFT:  { action: (c) => c.seekStep(-1), reenterAfter: true },
        KEY_RIGHT: { action: (c) => c.seekStep(+1), reenterAfter: true },
        KEY_ENTER: { target: 'seekFocus', action: (c) => c.seekCommit() },
        KEY_BACK:  { target: 'seekFocus', action: (c) => c.seekCancel() },
        BUFFERING:   'loading',
        FATAL_ERROR: 'error',
      },
    },

    buttonsFocus: {
      entry: (c) => { c.showBar(); c.setProgressActive(false); c.focusPanelButtons(); },
      exit:  (c) => c.unfocusPanelButtons(),
      after: { ms: UI_IDLE_MS, target: 'idle', action: (c) => c.markButtonsClosed() },
      on: {
        KEY_LEFT:  { action: (c) => c.panelPrevBtn(), reenterAfter: true },
        KEY_RIGHT: { action: (c) => c.panelNextBtn(), reenterAfter: true },
        KEY_ENTER: [
          {
            cond: (c) => c.isCurrentPanelBtnEnabled() && c.isCurrentPanelBtnInstant(),
            action: (c) => c.applyInstantPanelBtn(),
          },
          {
            target: 'sidePanelOpen',
            cond: (c) => c.isCurrentPanelBtnEnabled(),
          },
        ],
        KEY_DOWN:    { target: 'seekFocus', action: (c) => c.markButtonsClosed() },
        KEY_BACK:    { target: 'idle', action: (c) => c.markButtonsClosed() },
        BUFFERING:   'loading',
        FATAL_ERROR: 'error',
      },
    },

    sidePanelOpen: {
      entry: (c) => c.openSidePanel(),
      exit:  (c) => c.closeSidePanel(),
      on: {
        KEY_UP:   { action: (c) => c.sideListPrev() },
        KEY_DOWN: { action: (c) => c.sideListNext() },
        KEY_ENTER: {
          target: 'buttonsFocus',
          action: (c) => c.applySideSelection(),
        },
        KEY_LEFT:    'buttonsFocus',
        KEY_BACK:    'buttonsFocus',
        FATAL_ERROR: 'error',
      },
    },

    error: {
      entry: (c) => c.showError(),
      on: {
        KEY_BACK: { action: (c) => c.exit() },
      },
    },

  },
};
