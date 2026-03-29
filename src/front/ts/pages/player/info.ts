import $ from 'jquery';
import { VideoFile, AudioTrack, Subtitle } from '../../types/api';
import { getStreamingType } from '../../utils/storage';

export interface InfoState {
  files: VideoFile[];
  audios: AudioTrack[];
  subs: Subtitle[];
  selectedQuality: number;
  selectedAudio: number;
  selectedSub: number;
}

export function getStreamInfo(state: InfoState): string {
  var parts: string[] = [];

  parts.push(getStreamingType().toUpperCase());

  if (state.files.length > 0 && state.selectedQuality < state.files.length) {
    var f = state.files[state.selectedQuality];
    var ql = f.quality || (f.h + 'p');
    parts.push(ql + ' ' + f.w + '\u00d7' + f.h);
    if (f.codec) parts.push(f.codec.toUpperCase());
  }

  if (state.audios.length > 0 && state.selectedAudio < state.audios.length) {
    var a = state.audios[state.selectedAudio];
    var albl = a.lang;
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
