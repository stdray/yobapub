import { Logger } from '../../utils/log';
import { platform } from '../../utils/platform';
import { HlsEngine, formatBuffered } from './hls-engine';
import { OverlayView } from './overlay';
import { WatchProgressTracker } from './watch-tracker';
import { TrackNavigator } from './track-navigator';
import { PlayerErrorView } from './error-view';

export interface VideoBindingsDeps {
  readonly getVideoEl: () => HTMLVideoElement | null;
  readonly engine: HlsEngine;
  readonly overlay: OverlayView;
  readonly watchTracker: WatchProgressTracker;
  readonly trackNavigator: TrackNavigator;
  readonly errorView: PlayerErrorView;
  readonly sourceUrl: string;
  readonly log: Logger;
  // Startup reveal (see PlayerController.armStartTarget). While the resume
  // target is owed the spinner stays up and the element stays covered.
  readonly isStartTargetPending: (ct: number) => boolean;
  readonly isStartRevealOwed: () => boolean;
  readonly onStartReveal: (ct: number) => void;
  readonly onBack: () => void;
  readonly onFatalError: () => void;
}

// True when ct sits inside one of the buffered ranges. Outside them the decoder
// has nothing to show yet — hiding the spinner there uncovers the black gap
// between the resume seek and the first fragment at the target.
const isInsideBuffered = (v: HTMLVideoElement | null, ct: number): boolean => {
  if (!v || ct < 0) return false;
  const b = v.buffered;
  for (let i = 0; i < b.length; i++) {
    if (b.start(i) <= ct && ct < b.end(i)) return true;
  }
  return false;
};

export const bindVideoEvents = (videoEl: HTMLVideoElement, deps: VideoBindingsDeps): void => {
  const { log, engine, overlay, watchTracker, trackNavigator, errorView, sourceUrl, onBack } = deps;
  const getV = deps.getVideoEl;

  // On Android WebView the native Chromium overlay play button (giant blurred
  // triangle) ignores ::-webkit-media-controls-* hiding — it renders in a
  // separate compositor layer. Hide the video element until the first `playing`
  // event so the user sees black instead. On Tizen this breaks remote-control
  // media keys (Play/Pause/FF/RW), so only apply it on Android.
  const playerEl = videoEl.parentElement;
  if (platform.isAndroidWebView() && playerEl) {
    playerEl.classList.add('player--hide-video');
  }

  videoEl.addEventListener('ended', () => {
    log.info('video ended currentTime={currentTime}', { currentTime: getV() ? getV()!.currentTime : -1 });
    watchTracker.markWatched();
    if (!trackNavigator.navigate(1)) onBack();
  });
  videoEl.addEventListener('waiting', () => {
    log.debug('video waiting currentTime={currentTime}', { currentTime: getV() ? getV()!.currentTime : -1 });
    overlay.showSpinner();
  });
  videoEl.addEventListener('seeking', () => {
    const v = getV();
    log.debug('video seeking currentTime={currentTime}', { currentTime: v ? v.currentTime : -1 });
    // Tizen 2.3: hls.js seeks to startPosition but float drift lands ct just before buffered.start(0).
    // Gap-controller then nudges by 0.1, causing a second seek mid-playback that desyncs audio.
    // One-shot correction on the first startup seek — engine owns firstFragSnapped state.
    engine.onVideoSeeking();
  });
  videoEl.addEventListener('canplay', () => {
    const v = getV();
    log.debug('video canplay currentTime={currentTime}', { currentTime: v ? v.currentTime : -1 });
    if (!deps.isStartRevealOwed()) overlay.hideSpinner();
    // Fresh playback (pos=0): some HLS streams have first-segment PTS != 0, leaving the
    // SourceBuffer starting at e.g. 10.0 while playhead sits at 0. Gap-controller won't
    // close gaps > maxBufferHole. Snap once to the buffered start so playback can begin.
    engine.onVideoCanplay();
  });
  let startPendingLogged = false;
  videoEl.addEventListener('playing', () => {
    engine.onVideoPlaying();
    const v = getV();
    const ct = v ? v.currentTime : -1;
    log.info('video playing ct={ct} readyState={rs} buffered={br}', {
      ct,
      rs: v ? v.readyState : -1,
      br: formatBuffered(v),
    });
    if (deps.isStartTargetPending(ct)) {
      // Startup warmup: this is the first fragment, not the resume target.
      if (!startPendingLogged) {
        startPendingLogged = true;
        log.info('video playing held: start target pending ct={ct}', { ct });
      }
      return;
    }
    deps.onStartReveal(ct);
    overlay.hideSpinner();
    videoEl.classList.add('player__video--visible');
  });
  videoEl.addEventListener('timeupdate', () => {
    // Fallback for platforms where the resume seek does not re-fire `playing`.
    const v = getV();
    deps.onStartReveal(v ? v.currentTime : -1);
  });
  videoEl.addEventListener('seeked', () => {
    const v = getV();
    const ct = v ? v.currentTime : -1;
    log.debug('video seeked ct={ct} readyState={rs} buffered={br}', {
      ct,
      rs: v ? v.readyState : -1,
      br: formatBuffered(v),
    });
    // Only reveal when there is data at the playhead and the startup target is
    // settled; the warmup/seeked pair otherwise uncovers an empty gap.
    if (isInsideBuffered(v, ct) && !deps.isStartRevealOwed()) overlay.hideSpinner();
  });
  videoEl.addEventListener('error', () => {
    const v = getV();
    const err2 = v ? v.error : null;
    // Snapshot taken here, before any teardown — engine.getCurrentLevel()/
    // getCurrentLevelIndex() and v.currentTime itself can already read
    // reset/detached values by the time later code (onFatalError,
    // showPlaybackError) runs.
    const snap = engine.captureErrorSnapshot(v);
    log.error('video error code={code} message={message} ct={ct} readyState={rs} networkState={ns}'
      + ' buffered={br} decodedFrames={frames} hlsLevel={hlsLevel} hlsRes={hlsRes}'
      + ' videoCodec={vc} audioCodec={ac} hlsBitrate={hlsBitrate}'
      + ' lastFragSn={fsn} lastFragStart={fstart} lastFragSize={fsize}', {
      code: err2 ? err2.code : null,
      message: err2 ? (err2 as { message?: string }).message || null : null,
      ct: snap.ct,
      rs: snap.readyState,
      ns: snap.networkState,
      br: snap.buffered,
      frames: snap.decodedFrames,
      hlsLevel: snap.levelIndex,
      hlsRes: snap.level ? snap.level.width + 'x' + snap.level.height : null,
      vc: snap.level ? snap.level.videoCodec : null,
      ac: snap.level ? snap.level.audioCodec : null,
      hlsBitrate: snap.level ? snap.level.bitrate : null,
      fsn: snap.lastFragSn,
      fstart: snap.lastFragStart,
      fsize: snap.lastFragSize,
    });
    if (engine.tryRecoverVideoError()) return;
    if (v) { deps.onFatalError(); errorView.showPlaybackError(v.error, sourceUrl, snap); }
  });
};
