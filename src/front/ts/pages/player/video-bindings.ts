import { Logger } from '../../utils/log';
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
  readonly onBack: () => void;
  readonly onFatalError: () => void;
}

export const bindVideoEvents = (videoEl: HTMLVideoElement, deps: VideoBindingsDeps): void => {
  const { log, engine, overlay, watchTracker, trackNavigator, errorView, sourceUrl, onBack } = deps;
  const getV = deps.getVideoEl;

  videoEl.addEventListener('ended', () => {
    log.info('video ended currentTime={currentTime}', { currentTime: getV() ? getV()!.currentTime : -1 });
    if (!watchTracker.markedWatched) watchTracker.sendToggleWatched();
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
    overlay.hideSpinner();
    // Fresh playback (pos=0): some HLS streams have first-segment PTS != 0, leaving the
    // SourceBuffer starting at e.g. 10.0 while playhead sits at 0. Gap-controller won't
    // close gaps > maxBufferHole. Snap once to the buffered start so playback can begin.
    engine.onVideoCanplay();
  });
  videoEl.addEventListener('playing', () => {
    engine.onVideoPlaying();
    const v = getV();
    log.info('video playing ct={ct} readyState={rs} buffered={br}', {
      ct: v ? v.currentTime : -1,
      rs: v ? v.readyState : -1,
      br: formatBuffered(v),
    });
    overlay.hideSpinner();
    videoEl.classList.add('player__video--visible');
  });
  videoEl.addEventListener('seeked', () => {
    const v = getV();
    log.debug('video seeked ct={ct} readyState={rs} buffered={br}', {
      ct: v ? v.currentTime : -1,
      rs: v ? v.readyState : -1,
      br: formatBuffered(v),
    });
    overlay.hideSpinner();
  });
  videoEl.addEventListener('error', () => {
    const v = getV();
    const err2 = v ? v.error : null;
    const curLevel = engine.getCurrentLevel();
    log.error('video error code={code} message={message} ct={ct} readyState={rs}'
      + ' buffered={br} hlsLevel={hlsLevel} videoCodec={vc} audioCodec={ac} hlsBitrate={hlsBitrate}', {
      code: err2 ? err2.code : null,
      message: err2 ? (err2 as { message?: string }).message || null : null,
      ct: v ? v.currentTime : null,
      rs: v ? v.readyState : null,
      br: formatBuffered(v),
      hlsLevel: engine.getCurrentLevelIndex(),
      vc: curLevel ? curLevel.videoCodec : null,
      ac: curLevel ? curLevel.audioCodec : null,
      hlsBitrate: curLevel ? curLevel.bitrate : null,
    });
    if (engine.tryRecoverVideoError()) return;
    if (v) { deps.onFatalError(); errorView.showPlaybackError(v.error, sourceUrl); }
  });
};
