import $ from 'jquery';
import { VideoFile, AudioTrack, Subtitle } from '../../types/api';
import Hls from 'hls.js';


export interface InfoState {
  readonly files: VideoFile[];
  readonly audios: AudioTrack[];
  readonly subs: Subtitle[];
  readonly selectedQuality: number;
  readonly selectedAudio: number;
  readonly selectedSub: number;
  readonly hlsInstance: Hls | null;
}

export const getStreamInfo = (state: InfoState): string => {
  const parts: string[] = [];

  parts.push('HLS');

  if (state.files.length > 0 && state.selectedQuality < state.files.length) {
    const f = state.files[state.selectedQuality];
    const ql = f.quality || (f.h + 'p');
    parts.push(ql + ' ' + f.w + '\u00d7' + f.h);
    if (f.codec) parts.push(f.codec.toUpperCase());
  }

  if (state.audios.length > 0 && state.selectedAudio < state.audios.length) {
    const a = state.audios[state.selectedAudio];
    let albl = a.lang;
    if (a.author && a.author.title) albl += ' (' + a.author.title + ')';
    albl += ' ' + a.codec + ' ' + a.channels + 'ch';
    parts.push(albl);
  }

  if (state.selectedSub >= 0 && state.selectedSub < state.subs.length) {
    parts.push('Sub: ' + state.subs[state.selectedSub].lang.toUpperCase());
  }

  if (state.hlsInstance) {
    const hls = state.hlsInstance as { readonly levels?: ReadonlyArray<{ readonly bitrate?: number }>; readonly currentLevel?: number };
    const level = hls.levels && hls.currentLevel !== undefined && hls.currentLevel >= 0
      ? hls.levels[hls.currentLevel]
      : undefined;
    if (level && level.bitrate) {
      const mbps = (level.bitrate / 1000000).toFixed(1);
      parts.push(mbps + ' Mbps');
    }
  }

  return parts.join(' &bull; ');
};

export const updateInfoBadge = ($root: JQuery, state: InfoState): void => {
  $root.find('.player__info').html(getStreamInfo(state));
};

export const showInfo = ($root: JQuery, state: InfoState): void => {
  updateInfoBadge($root, state);
  $root.find('.player__info').removeClass('hidden');
};

export const hideInfo = ($root: JQuery): void => {
  $root.find('.player__info').addClass('hidden');
};
