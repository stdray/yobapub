import $ from 'jquery';
import { VideoFile, AudioTrack, Subtitle } from '../../types/api';


export interface InfoState {
  files: VideoFile[];
  audios: AudioTrack[];
  subs: Subtitle[];
  selectedQuality: number;
  selectedAudio: number;
  selectedSub: number;
}

export function getStreamInfo(state: InfoState): string {
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

  return parts.join(' &bull; ');
}

export function updateInfoBadge($root: JQuery, state: InfoState): void {
  $root.find('.player__info').html(getStreamInfo(state));
}

export function showInfo($root: JQuery, state: InfoState): void {
  updateInfoBadge($root, state);
  $root.find('.player__info').removeClass('hidden');
}

export function hideInfo($root: JQuery): void {
  $root.find('.player__info').addClass('hidden');
}
