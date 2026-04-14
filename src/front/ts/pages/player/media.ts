import { apiClient } from '../../api/client';
import { Item, VideoFile, AudioTrack, Subtitle, MediaLinksResponse, WatchingInfoItem } from '../../types/api';
import { Logger } from '../../utils/log';
import { arrayFind } from '../../utils/array';

const subsDiagLog = new Logger('subs-diag');
const mediaLog = new Logger('media-diag');

export interface MediaInfo {
  mid: number;
  title: string;
  audios: AudioTrack[];
  duration: number;
}

interface FoundEpisode {
  season: NonNullable<Item['seasons']>[number];
  episode: NonNullable<Item['seasons']>[number]['episodes'][number];
}

const findEpisode = (item: Item, seasonNum: number, epNum: number): FoundEpisode | undefined => {
  if (!item.seasons) return undefined;
  const s = arrayFind(item.seasons, (ss) => ss.number === seasonNum);
  if (!s) return undefined;
  const ep = arrayFind(s.episodes, (e) => e.number === epNum);
  if (!ep) return undefined;
  return { season: s, episode: ep };
};

export const findEpisodeMedia = (item: Item, seasonNum: number, epNum: number): MediaInfo | null => {
  const found = findEpisode(item, seasonNum, epNum);
  if (!found) return null;
  const ep = found.episode;
  return {
    mid: ep.id,
    title: ep.title || 'S' + seasonNum + 'E' + epNum,
    audios: ep.audios || [],
    duration: ep.duration || 0,
  };
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
  mediaLog.info('loadMediaLinks start mid={mid}', { mid });
  apiClient.apiGet('/v1/items/media-links', { mid: mid }).then(
    (res: MediaLinksResponse) => {
      const files: VideoFile[] = (res && res.files) || [];
      const subs: Subtitle[] = (res && res.subtitles) || [];
      mediaLog.info('loadMediaLinks ok files={files} subs={subs}', { files: files.length, subs: subs.length });
      subsDiagLog.info('raw api count={count} json={json}', {
        count: subs.length,
        json: JSON.stringify(subs),
      });
      cb(files, subs);
    },
    (xhr: JQueryXHR) => {
      mediaLog.error('loadMediaLinks failed status={status} text={text} resp={resp}', {
        status: xhr ? xhr.status : -1,
        text: xhr ? String(xhr.statusText || '') : '',
        resp: xhr ? String(xhr.responseText || '').substring(0, 200) : '',
      });
      cb([], []);
    }
  );
};



export const isEpisodeWatched = (item: Item, seasonNum: number, epNum: number): boolean => {
  const found = findEpisode(item, seasonNum, epNum);
  if (!found) return false;
  return found.episode.watching !== undefined && found.episode.watching.status === 1;
};

export const isVideoWatched = (item: Item, videoNum: number): boolean => {
  if (!item.videos) return false;
  const idx = videoNum - 1;
  return idx >= 0 && idx < item.videos.length && item.videos[idx].watched === 1;
};

const isValidResume = (time: number, duration?: number): boolean =>
  time > 0 && duration !== undefined && time < duration - 10;

const findWatchingEpisode = (
  watching: WatchingInfoItem, seasonNum: number, epNum: number,
): { time: number; status: number; duration: number } | null => {
  if (!watching.seasons) return null;
  const ws = arrayFind(watching.seasons, (s) => s.number === seasonNum);
  if (!ws) return null;
  const we = arrayFind(ws.episodes, (e) => e.number === epNum);
  return we ? { time: we.time, status: we.status, duration: we.duration } : null;
};

// /v1/watching?id= is the authoritative source for fresh time/status (the nested
// /v1/items/{id}.seasons[].episodes[].watching is cached server-side and can lag
// minutes behind marktime calls). Prefer watching when available, fall back to
// the item's embedded state otherwise.
export const getResumeTime = (
  item: Item, watching: WatchingInfoItem | null,
  seasonNum?: number, epNum?: number, videoNum?: number,
): number => {
  if (seasonNum !== undefined && epNum !== undefined) {
    const we = watching ? findWatchingEpisode(watching, seasonNum, epNum) : null;
    if (we) {
      mediaLog.info('getResumeTime serial(watching) s={s} e={e} time={t} status={st} dur={d}', {
        s: seasonNum, e: epNum, t: we.time, st: we.status, d: we.duration,
      });
      return isValidResume(we.time, we.duration) ? we.time : 0;
    }
    if (item.seasons) {
      const found = findEpisode(item, seasonNum, epNum);
      const ep = found && found.episode;
      mediaLog.info('getResumeTime serial(item) s={s} e={e} epFound={ef} wTime={wt} dur={d}', {
        s: seasonNum, e: epNum, ef: !!ep,
        wt: ep && ep.watching ? ep.watching.time : -1,
        d: ep ? ep.duration : -1,
      });
      if (ep && ep.watching && isValidResume(ep.watching.time, ep.duration)) return ep.watching.time;
    }
  } else if (videoNum !== undefined) {
    if (watching && watching.videos) {
      const wv = watching.videos[videoNum - 1];
      if (wv) {
        mediaLog.info('getResumeTime movie(watching) v={v} time={t} dur={d}', {
          v: videoNum, t: wv.time, d: wv.duration,
        });
        if (isValidResume(wv.time, wv.duration)) return wv.time;
        return 0;
      }
    }
    if (item.videos) {
      const v = item.videos[videoNum - 1];
      mediaLog.info('getResumeTime movie(item) v={v} wTime={wt} dur={d}', {
        v: videoNum,
        wt: v && v.watching ? v.watching.time : -1,
        d: v ? v.duration : -1,
      });
      if (v && v.watching && isValidResume(v.watching.time, v.duration)) return v.watching.time;
    }
  }
  return 0;
};
