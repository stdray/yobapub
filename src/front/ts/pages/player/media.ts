import { apiClient } from '../../api/client';
import { Item, VideoFile, AudioTrack, Subtitle, MediaLinksResponse } from '../../types/api';

export interface MediaInfo {
  mid: number;
  title: string;
  audios: AudioTrack[];
  duration: number;
}

export const findEpisodeMedia = (item: Item, seasonNum: number, epNum: number): MediaInfo | null => {
  if (!item.seasons) return null;
  for (let i = 0; i < item.seasons.length; i++) {
    const s = item.seasons[i];
    if (s.number === seasonNum) {
      for (let j = 0; j < s.episodes.length; j++) {
        const ep = s.episodes[j];
        if (ep.number === epNum) {
          return { mid: ep.id, title: ep.title || 'S' + seasonNum + 'E' + epNum, audios: ep.audios || [], duration: ep.duration || 0 };
        }
      }
    }
  }
  return null;
};

export const findVideoMedia = (item: Item, videoNum: number): MediaInfo | null => {
  if (!item.videos) return null;
  const idx = videoNum - 1;
  if (idx >= 0 && idx < item.videos.length) {
    const v = item.videos[idx];
    return { mid: v.id, title: v.title || 'Видео ' + videoNum, audios: v.audios || [], duration: v.duration || 0 };
  }
  return null;
};

export const loadMediaLinks = (mid: number, cb: (files: VideoFile[], subs: Subtitle[]) => void): void => {
  apiClient.apiGet('/v1/items/media-links', { mid: mid }).then(
    (res: MediaLinksResponse) => {
      const files: VideoFile[] = (res && res.files) || [];
      const subs: Subtitle[] = (res && res.subtitles) || [];
      cb(files, subs);
    },
    () => { cb([], []); }
  );
};



export const isEpisodeWatched = (item: Item, seasonNum: number, epNum: number): boolean => {
  if (!item.seasons) return false;
  for (let i = 0; i < item.seasons.length; i++) {
    const s = item.seasons[i];
    if (s.number === seasonNum) {
      for (let j = 0; j < s.episodes.length; j++) {
        const ep = s.episodes[j];
        if (ep.number === epNum) {
          return ep.watching !== undefined && ep.watching.status === 1;
        }
      }
    }
  }
  return false;
};

export const isVideoWatched = (item: Item, videoNum: number): boolean => {
  if (!item.videos) return false;
  const idx = videoNum - 1;
  return idx >= 0 && idx < item.videos.length && item.videos[idx].watched === 1;
};

const isValidResume = (time: number, duration?: number): boolean =>
  time > 0 && duration !== undefined && time < duration - 10;

export const getResumeTime = (item: Item, seasonNum?: number, epNum?: number, videoNum?: number): number => {
  if (seasonNum !== undefined && epNum !== undefined && item.seasons) {
    const s = item.seasons.find((ss) => ss.number === seasonNum);
    const ep = s && s.episodes.find((e) => e.number === epNum);
    if (ep && ep.watching && isValidResume(ep.watching.time, ep.duration)) return ep.watching.time;
  } else if (videoNum !== undefined && item.videos) {
    const v = item.videos[videoNum - 1];
    if (v && v.watching && isValidResume(v.watching.time, v.duration)) return v.watching.time;
  }
  return 0;
};
