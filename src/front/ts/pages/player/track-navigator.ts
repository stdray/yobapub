import { Item } from '../../types/api';
import { arrayFindIndex } from '../../utils/array';

export interface TrackNavigatorDeps {
  readonly getItem: () => Item | null;
  readonly getSeason: () => number | undefined;
  readonly getEpisode: () => number | undefined;
  readonly getVideo: () => number | undefined;
  readonly setSeasonEpisode: (season: number, episode: number) => void;
  readonly setVideo: (video: number) => void;
  readonly onBeforeSwitch: () => void;
  readonly onAfterSwitch: () => void;
}

export class TrackNavigator {
  constructor(private readonly deps: TrackNavigatorDeps) {}

  navigate(dir: number): boolean {
    const item = this.deps.getItem();
    if (!item) return false;

    const season = this.deps.getSeason();
    const episode = this.deps.getEpisode();
    if (season !== undefined && episode !== undefined) {
      return this.navigateEpisode(item, season, episode, dir);
    }

    const video = this.deps.getVideo();
    if (video !== undefined && item.videos) {
      const newVideo = video + dir;
      if (newVideo >= 1 && newVideo <= item.videos.length) {
        this.switchTo(() => this.deps.setVideo(newVideo));
        return true;
      }
    }
    return false;
  }

  private navigateEpisode(item: Item, season: number, episode: number, dir: number): boolean {
    if (!item.seasons) return false;
    const si = arrayFindIndex(item.seasons, (s) => s.number === season);
    if (si < 0) return false;
    const s = item.seasons[si];
    const ei = arrayFindIndex(s.episodes, (ep) => ep.number === episode);
    if (ei < 0) return false;

    const nextEi = ei + dir;
    if (nextEi >= 0 && nextEi < s.episodes.length) {
      this.switchTo(() => this.deps.setSeasonEpisode(season, s.episodes[nextEi].number));
      return true;
    }

    const nextSi = si + dir;
    if (nextSi >= 0 && nextSi < item.seasons.length) {
      const ns = item.seasons[nextSi];
      const ep = dir > 0 ? ns.episodes[0] : ns.episodes[ns.episodes.length - 1];
      if (ep) {
        this.switchTo(() => this.deps.setSeasonEpisode(ns.number, ep.number));
        return true;
      }
    }
    return false;
  }

  private switchTo(mutator: () => void): void {
    this.deps.onBeforeSwitch();
    mutator();
    this.deps.onAfterSwitch();
  }
}
