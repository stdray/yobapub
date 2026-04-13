import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { loadItemWithWatching } from '../api/items';
import { Item, Season, WatchingInfoItem } from '../types/api';
import { router } from '../router';
import { TvKey } from '../utils/platform';
import { PageKeys, PageUtils } from '../utils/page';
import { renderRatings, renderPersonnel } from '../utils/templates';
import { formatTimeShort } from '../utils/format';
import { storage } from '../utils/storage';
import { DetailControls } from '../utils/detail-controls';

// --- templates ---

const tplDetailCompiled = doT.template(`
  <div class="detail">
    <div class="detail__left">
      <div class="detail__poster"><img src="{{=it.poster}}" alt=""></div>
      <div class="detail__ep-preview"></div>
    </div>
    <div class="detail__info">
      <div class="detail__title">{{=it.titleRu}}</div>
      {{?it.titleEn}}<div class="detail__original-title">{{=it.titleEn}}</div>{{?}}
      <div class="detail__meta">{{=it.year}} &bull; {{=it.countries}}</div>
      <div class="detail__meta">{{=it.genres}}</div>
      <div class="detail__ratings">{{=it.bookmarksTpl}}</div>
      <div class="detail__ratings">{{=it.ratings}}{{=it.watchlistTpl}}</div>
      <div class="detail__actions"><div class="btn" data-action="play">{{=it.playLabel}}</div></div>
      <div class="detail__plot">{{=it.plot}}</div>
      {{?it.personnel}}<div class="detail__personnel">{{=it.personnel}}</div>{{?}}
      <div class="episodes">
        <div class="episodes__seasons">{{=it.seasonTabs}}</div>
        <div class="episodes__list">{{=it.episodes}}</div>
      </div>
    </div>
  </div>
`);

interface DetailData {
  readonly poster: string;
  readonly titleRu: string;
  readonly titleEn: string;
  readonly year: number;
  readonly countries: string;
  readonly genres: string;
  readonly ratings: string;
  readonly plot: string;
  readonly playLabel: string;
  readonly seasonTabs: string;
  readonly episodes: string;
  readonly bookmarksTpl: string;
  readonly watchlistTpl: string;
  readonly personnel: string;
}

const tplDetail = (data: DetailData): string => tplDetailCompiled(data);

const tplSeasonTabCompiled = doT.template(`
  <div class="episodes__season-tab{{?it.active}} active{{?}}" data-season="{{=it.idx}}">Сезон {{=it.num}}</div>
`);

const tplSeasonTab = (data: { readonly idx: number; readonly num: number; readonly active: boolean }): string =>
  tplSeasonTabCompiled(data);

const tplEpisodeCompiled = doT.template(`
  <div class="episode" data-ep="{{=it.idx}}" data-thumb="{{=it.thumbnail}}">
    <div class="episode__thumb{{?!it.thumbnail}} episode__thumb--empty{{?}}">
      {{?it.thumbnail}}<img src="{{=it.thumbnail}}" alt="" loading="lazy">{{??}}&#9654;{{?}}
    </div>
    <div class="episode__body">
      <span class="episode__number">{{=it.number}}</span>
      <span class="episode__title">{{=it.title}}</span>
      <span class="episode__status">{{=it.status}}</span>
    </div>
  </div>
`);

interface EpisodeData {
  readonly idx: number;
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly thumbnail: string;
}

const tplEpisode = (data: EpisodeData): string => tplEpisodeCompiled(data);

// --- page ---

type FocusArea = 'bookmarks' | 'watchlist' | 'play' | 'seasons' | 'episodes';

class SerialPage implements Page {
  private readonly $root = $('#page-serial');
  private readonly keys = new PageKeys();
  private readonly controls = new DetailControls(this.$root);

  private item: Item | null = null;
  private watching: WatchingInfoItem | null = null;
  private focusArea: FocusArea = 'play';
  private selectedSeason = 0;
  private focusedEpisode = 0;
  private focusedSeasonTab = 0;

  // --- data helpers ---

  private get seasons(): ReadonlyArray<Season> {
    return (this.item && this.item.seasons) || [];
  }

  private getEpisodeStatus(seasonNum: number, epNum: number): { time: number; status: number } {
    if (!this.watching || !this.watching.seasons) return { time: 0, status: -1 };
    for (let i = 0; i < this.watching.seasons.length; i++) {
      const ws = this.watching.seasons[i];
      if (ws.number === seasonNum) {
        for (let j = 0; j < ws.episodes.length; j++) {
          if (ws.episodes[j].number === epNum) {
            return { time: ws.episodes[j].time, status: ws.episodes[j].status };
          }
        }
      }
    }
    return { time: 0, status: -1 };
  }

  private findEpisodeById(episodeId: number): { seasonIdx: number; episodeIdx: number } | null {
    if (!this.item || !this.item.seasons) return null;
    for (let i = 0; i < this.item.seasons.length; i++) {
      const s = this.item.seasons[i];
      for (let j = 0; j < s.episodes.length; j++) {
        if (s.episodes[j].id === episodeId) return { seasonIdx: i, episodeIdx: j };
      }
    }
    return null;
  }

  private findResumeEpisode(): {
    season: number; episode: number; seasonIdx: number; episodeIdx: number;
  } | null {
    if (!this.item || !this.item.seasons) return null;
    for (let i = 0; i < this.item.seasons.length; i++) {
      const s = this.item.seasons[i];
      for (let j = 0; j < s.episodes.length; j++) {
        const st = this.getEpisodeStatus(s.number, s.episodes[j].number);
        if (st.status === 0 || st.status === -1) {
          return { season: s.number, episode: s.episodes[j].number, seasonIdx: i, episodeIdx: j };
        }
      }
    }
    return null;
  }

  // --- render ---

  private buildEpisodes(season: Season | undefined): string {
    if (!season) return '';
    let html = '';
    for (let j = 0; j < season.episodes.length; j++) {
      const ep = season.episodes[j];
      const st = this.getEpisodeStatus(season.number, ep.number);
      let statusText = '';
      if (st.status === 1) statusText = '✓';
      else if (st.status === 0 && st.time > 0) statusText = formatTimeShort(st.time);
      html += tplEpisode({
        idx: j, number: ep.number,
        title: ep.title || 'Эпизод ' + ep.number,
        status: statusText,
        thumbnail: ep.thumbnail ? storage.proxyPosterUrl(ep.thumbnail) : '',
      });
    }
    return html;
  }

  private render(): void {
    const item = this.item!;
    const title = item.title.split(' / ');
    const seasons = this.seasons;

    const resumeEp = this.findResumeEpisode();
    const playLabel = resumeEp ? 'Продолжить S' + resumeEp.season + 'E' + resumeEp.episode : 'Смотреть';

    if (resumeEp) this.selectedSeason = resumeEp.seasonIdx;

    let seasonTabs = '';
    for (let i = 0; i < seasons.length; i++) {
      seasonTabs += tplSeasonTab({ idx: i, num: seasons[i].number, active: i === this.selectedSeason });
    }

    this.$root.html(tplDetail({
      poster: storage.proxyPosterUrl(item.posters.big),
      titleRu: title[0],
      titleEn: title.length > 1 ? title[1] : '',
      year: item.year,
      countries: item.countries.map((c) => c.title).join(', '),
      genres: item.genres.map((g) => g.title).join(', '),
      ratings: renderRatings(item),
      plot: item.plot || '',
      playLabel,
      seasonTabs,
      episodes: this.buildEpisodes(seasons[this.selectedSeason]),
      bookmarksTpl: this.controls.bookmarksTpl(),
      watchlistTpl: this.controls.watchlistTpl(item.in_watchlist),
      personnel: renderPersonnel(item),
    }));

    this.focusedSeasonTab = this.selectedSeason;
    this.focusArea = 'play';
    this.focusedEpisode = resumeEp ? resumeEp.episodeIdx : 0;

    this.updateFocus();

    if (resumeEp) {
      this.$root.find('.episode').eq(resumeEp.episodeIdx).addClass('current');
    }

    this.controls.loadBookmarks(item.id);
  }

  // --- focus ---

  private updateFocus(): void {
    this.$root.find('.btn').removeClass('focused');
    this.$root.find('.detail__rating.focusable').removeClass('focused');
    this.$root.find('.episodes__season-tab').removeClass('focused');
    this.$root.find('.episode').removeClass('focused');

    const infoEl = this.$root.find('.detail__info')[0];

    switch (this.focusArea) {
      case 'bookmarks': {
        this.$root.find('[data-action="bookmark"]').addClass('focused');
        if (infoEl) infoEl.scrollTop = 0;
        break;
      }
      case 'watchlist': {
        this.$root.find('[data-action="watchlist"]').addClass('focused');
        if (infoEl) infoEl.scrollTop = 0;
        break;
      }
      case 'play': {
        this.$root.find('.btn').eq(0).addClass('focused');
        if (infoEl) infoEl.scrollTop = 0;
        break;
      }
      case 'seasons': {
        const $el = this.$root.find('.episodes__season-tab').eq(this.focusedSeasonTab);
        $el.addClass('focused');
        if ($el[0] && infoEl) PageUtils.scrollIntoView($el[0], infoEl, 20);
        break;
      }
      case 'episodes': {
        const $eps = this.$root.find('.episode');
        if ($eps.length > 0) {
          const $ep = $eps.eq(this.focusedEpisode);
          $ep.addClass('focused');
          if (infoEl) PageUtils.scrollIntoView($ep[0], infoEl, 20);
        }
        break;
      }
    }

    this.updateEpisodePreview();
  }

  private updateEpisodePreview(): void {
    const $preview = this.$root.find('.detail__ep-preview');
    let thumb = '';

    if (this.focusArea === 'episodes') {
      thumb = this.$root.find('.episode').eq(this.focusedEpisode).attr('data-thumb') || '';
    } else if (this.focusArea === 'play' && this.item && this.item.seasons) {
      const resume = this.findResumeEpisode();
      if (resume) {
        const ep = this.item.seasons[resume.seasonIdx].episodes[resume.episodeIdx];
        thumb = ep.thumbnail ? storage.proxyPosterUrl(ep.thumbnail) : '';
      } else if (this.item.seasons.length > 0 && this.item.seasons[0].episodes.length > 0) {
        const ep = this.item.seasons[0].episodes[0];
        thumb = ep.thumbnail ? storage.proxyPosterUrl(ep.thumbnail) : '';
      }
    }

    $preview.html(thumb ? '<img src="' + thumb + '" alt="">' : '');
  }

  private switchSeason(idx: number): void {
    this.selectedSeason = idx;
    this.focusedSeasonTab = idx;
    this.$root.find('.episodes__season-tab').removeClass('active').eq(idx).addClass('active');
    this.$root.find('.episodes__list').html(this.buildEpisodes(this.seasons[idx]));
    this.focusedEpisode = 0;
    this.updateFocus();
  }

  // --- keys ---

  private readonly handleKey = (e: JQuery.Event): void => {
    if (e.keyCode === TvKey.Return || e.keyCode === TvKey.Backspace || e.keyCode === TvKey.Escape) {
      if (this.focusArea === 'bookmarks') {
        this.focusArea = 'play'; this.updateFocus();
      } else {
        router.goBack();
      }
      e.preventDefault();
      return;
    }

    switch (this.focusArea) {
      case 'bookmarks': this.handleBookmarksKey(e); break;
      case 'watchlist': this.handleWatchlistKey(e); break;
      case 'play': this.handlePlayKey(e); break;
      case 'seasons': this.handleSeasonsKey(e); break;
      case 'episodes': this.handleEpisodesKey(e); break;
    }
  };

  private handleBookmarksKey(e: JQuery.Event): void {
    switch (e.keyCode) {
      case TvKey.Left: this.controls.prevFolder(); e.preventDefault(); break;
      case TvKey.Right: this.controls.nextFolder(); e.preventDefault(); break;
      case TvKey.Down: this.focusArea = 'watchlist'; this.updateFocus(); e.preventDefault(); break;
      case TvKey.Enter: this.controls.toggleBookmark(); e.preventDefault(); break;
    }
  }

  private handleWatchlistKey(e: JQuery.Event): void {
    switch (e.keyCode) {
      case TvKey.Up: this.focusArea = 'bookmarks'; this.updateFocus(); e.preventDefault(); break;
      case TvKey.Down: this.focusArea = 'play'; this.updateFocus(); e.preventDefault(); break;
      case TvKey.Enter:
        if (this.item) this.controls.toggleWatchlist(this.item.id);
        e.preventDefault(); break;
    }
  }

  private handlePlayKey(e: JQuery.Event): void {
    switch (e.keyCode) {
      case TvKey.Up: this.focusArea = 'watchlist'; this.updateFocus(); e.preventDefault(); break;
      case TvKey.Down:
        if (this.seasons.length > 0) { this.focusArea = 'seasons'; this.updateFocus(); }
        e.preventDefault(); break;
      case TvKey.Enter:
        this.playResume();
        e.preventDefault(); break;
    }
  }

  private handleSeasonsKey(e: JQuery.Event): void {
    switch (e.keyCode) {
      case TvKey.Left:
        if (this.focusedSeasonTab > 0) { this.focusedSeasonTab--; this.switchSeason(this.focusedSeasonTab); }
        e.preventDefault(); break;
      case TvKey.Right:
        if (this.focusedSeasonTab < this.seasons.length - 1) {
          this.focusedSeasonTab++; this.switchSeason(this.focusedSeasonTab);
        }
        e.preventDefault(); break;
      case TvKey.Up:
        this.focusArea = 'play'; this.updateFocus(); e.preventDefault(); break;
      case TvKey.Down: {
        const s = this.seasons[this.selectedSeason];
        if (s && s.episodes.length > 0) {
          this.focusArea = 'episodes'; this.focusedEpisode = 0; this.updateFocus();
        }
        e.preventDefault(); break;
      }
      case TvKey.Enter:
        this.switchSeason(this.focusedSeasonTab); e.preventDefault(); break;
    }
  }

  private handleEpisodesKey(e: JQuery.Event): void {
    const epCount = this.$root.find('.episode').length;
    switch (e.keyCode) {
      case TvKey.Down:
        if (this.focusedEpisode < epCount - 1) { this.focusedEpisode++; this.updateFocus(); }
        e.preventDefault(); break;
      case TvKey.Up:
        if (this.focusedEpisode > 0) { this.focusedEpisode--; this.updateFocus(); }
        else { this.focusArea = 'seasons'; this.updateFocus(); }
        e.preventDefault(); break;
      case TvKey.Enter: {
        const s = this.seasons[this.selectedSeason];
        if (this.item && s) {
          const ep = s.episodes[this.focusedEpisode];
          if (ep) router.navigateSerialPlayer(this.item.id, s.number, ep.number);
        }
        e.preventDefault(); break;
      }
    }
  }

  private playResume(): void {
    if (!this.item) return;
    const resume = this.findResumeEpisode();
    if (resume) {
      router.navigateSerialPlayer(this.item.id, resume.season, resume.episode);
    } else if (this.seasons.length > 0 && this.seasons[0].episodes.length > 0) {
      router.navigateSerialPlayer(this.item.id, this.seasons[0].number, this.seasons[0].episodes[0].number);
    }
  }

  // --- Page ---

  mount(params: RouteParams): void {
    this.item = null;
    this.watching = null;
    this.selectedSeason = 0;
    this.controls.reset();
    PageUtils.showSpinnerIn(this.$root);

    const targetEpisodeId = params.episodeId;

    loadItemWithWatching(params.id!,
      (item, watching) => {
        this.item = item;
        this.watching = watching;
        this.render();
        if (targetEpisodeId) {
          const found = this.findEpisodeById(targetEpisodeId);
          if (found) {
            if (found.seasonIdx !== this.selectedSeason) this.switchSeason(found.seasonIdx);
            this.focusArea = 'episodes';
            this.focusedEpisode = found.episodeIdx;
            this.updateFocus();
          }
        }
      },
      () => {
        this.$root.html(
          '<div class="detail"><div class="detail__info">' +
          '<div class="detail__title">Ошибка загрузки</div></div></div>',
        );
      },
    );
    this.keys.bind(this.handleKey);
  }

  unmount(): void {
    this.keys.unbind();
    PageUtils.clearPage(this.$root);
    this.item = null;
    this.watching = null;
  }
}

export const serialPage = new SerialPage();
