import $ from 'jquery';
import { apiGet } from '../../api/client';
import { Item, VideoFile, AudioTrack, Subtitle } from '../../types/api';
import { getStreamingType, isProxyAll, proxyUrl } from '../../utils/storage';

export interface MediaInfo {
  mid: number;
  title: string;
  audios: AudioTrack[];
  duration: number;
}

export function getUrlFromFile(f: VideoFile): string {
  var urls = f.urls || f.url;
  if (!urls) return '';
  var pref = getStreamingType();
  var url = '';
  if (pref === 'http' && urls.http) url = urls.http;
  else if (pref === 'hls' && urls.hls) url = urls.hls;
  else if (pref === 'hls2' && urls.hls2) url = urls.hls2;
  else if (pref === 'hls4' && urls.hls4) url = urls.hls4;
  else url = urls.hls4 || urls.hls || urls.http || '';
  return isProxyAll() ? proxyUrl(url) : url;
}

export function findEpisodeMedia(item: Item, seasonNum: number, epNum: number): MediaInfo | null {
  if (!item.seasons) return null;
  for (var i = 0; i < item.seasons.length; i++) {
    var s = item.seasons[i];
    if (s.number === seasonNum) {
      for (var j = 0; j < s.episodes.length; j++) {
        var ep = s.episodes[j];
        if (ep.number === epNum) {
          return { mid: ep.id, title: ep.title || 'S' + seasonNum + 'E' + epNum, audios: ep.audios || [], duration: ep.duration || 0 };
        }
      }
    }
  }
  return null;
}

export function findVideoMedia(item: Item, videoNum: number): MediaInfo | null {
  if (!item.videos) return null;
  var idx = videoNum - 1;
  if (idx >= 0 && idx < item.videos.length) {
    var v = item.videos[idx];
    return { mid: v.id, title: v.title || 'Видео ' + videoNum, audios: v.audios || [], duration: v.duration || 0 };
  }
  return null;
}

export function loadMediaLinks(mid: number, cb: (files: VideoFile[], subs: Subtitle[]) => void): void {
  apiGet('/v1/items/media-links', { mid: mid }).then(
    function (res: any) {
      var data = Array.isArray(res) ? res[0] : res;
      var files: VideoFile[] = (data && data.files) || [];
      var subs: Subtitle[] = (data && data.subtitles) || [];
      cb(files, subs);
    },
    function () { cb([], []); }
  );
}

export interface MediaLinksResult { files: VideoFile[]; subs: Subtitle[]; }

export function loadMediaLinksDeferred(mid: number): JQueryDeferred<MediaLinksResult> {
  var d = $.Deferred<MediaLinksResult>();
  apiGet('/v1/items/media-links', { mid: mid }).then(
    function (res: any) {
      var data = Array.isArray(res) ? res[0] : res;
      d.resolve({ files: (data && data.files) || [], subs: (data && data.subtitles) || [] });
    },
    function () { d.resolve({ files: [], subs: [] }); }
  );
  return d;
}

export function getResumeTime(item: Item, seasonNum?: number, epNum?: number, videoNum?: number): number {
  if (seasonNum !== undefined && epNum !== undefined && item.seasons) {
    for (var i = 0; i < item.seasons.length; i++) {
      var s = item.seasons[i];
      if (s.number === seasonNum) {
        for (var j = 0; j < s.episodes.length; j++) {
          var ep = s.episodes[j];
          if (ep.number === epNum && ep.watching) {
            var t = ep.watching.time;
            if (t > 0 && ep.duration && t < ep.duration - 10) return t;
          }
        }
      }
    }
  } else if (videoNum !== undefined && item.videos) {
    var vi = videoNum - 1;
    if (vi >= 0 && vi < item.videos.length) {
      var v = item.videos[vi];
      if (v.watching && v.watching.time > 0 && v.duration && v.watching.time < v.duration - 10) return v.watching.time;
    }
  }
  return 0;
}
