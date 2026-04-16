import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { loadItemWithWatching } from '../api/items';
import { Item, WatchingInfoItem } from '../types/api';
import { router } from '../router';
import { TvKey } from '../utils/platform';
import { PageKeys, PageUtils } from '../utils/page';
import { renderRatings, renderPersonnel } from '../utils/templates';
import { formatDuration } from '../utils/format';
import { storage } from '../utils/storage';
import { DetailControls } from '../utils/detail-controls';

// --- template ---

const tplDetailCompiled = doT.template(`
  <div class="detail">
    <div class="detail__left">
      <div class="detail__poster"><img src="{{=it.poster}}" alt=""></div>
    </div>
    <div class="detail__info">
      <div class="detail__title">{{=it.titleRu}}</div>
      {{?it.titleEn}}<div class="detail__original-title">{{=it.titleEn}}</div>{{?}}
      <div class="detail__meta">{{=it.year}} &bull; {{=it.countries}}</div>
      <div class="detail__meta">{{=it.genres}}</div>
      <div class="detail__ratings">{{=it.bookmarksTpl}}</div>
      {{?it.duration}}<div class="detail__meta">{{=it.duration}} &bull; {{=it.quality}}p</div>{{?}}
      <div class="detail__ratings">{{=it.ratings}}{{=it.watchedTpl}}</div>
      <div class="detail__actions">{{=it.buttons}}</div>
      <div class="detail__plot">{{=it.plot}}</div>
      {{?it.personnel}}<div class="detail__personnel">{{=it.personnel}}</div>{{?}}
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
  readonly duration: string;
  readonly quality: number;
  readonly ratings: string;
  readonly buttons: string;
  readonly plot: string;
  readonly bookmarksTpl: string;
  readonly watchedTpl: string;
  readonly personnel: string;
}

const tplDetail = (data: DetailData): string => tplDetailCompiled(data);

// --- page ---

type FocusArea = 'bookmarks' | 'watched' | 'play';

class MoviePage implements Page {
  private readonly $root = $('#page-movie');
  private readonly keys = new PageKeys();
  private readonly controls = new DetailControls(this.$root);

  private item: Item | null = null;
  private watching: WatchingInfoItem | null = null;
  private focusArea: FocusArea = 'play';

  // --- render ---

  private render(): void {
    const item = this.item!;
    const title = item.title.split(' / ');

    const video = this.watching && this.watching.videos && this.watching.videos.length > 0 ? this.watching.videos[0] : null;
    const resumeTime = video && video.status === 0 && video.time > 0 && video.time < video.duration - 10 ? video.time : 0;
    const isWatched = video !== null && video.status === 1;
    this.controls.initWatched(isWatched);

    const buttons = '<div class="btn" data-action="play">' +
      (resumeTime > 0 ? 'Продолжить с ' + formatDuration(resumeTime) : 'Смотреть') + '</div>';

    this.$root.html(tplDetail({
      poster: storage.proxyPosterUrl(item.posters.big),
      titleRu: title[0],
      titleEn: title.length > 1 ? title[1] : '',
      year: item.year,
      countries: item.countries.map((c) => c.title).join(', '),
      genres: item.genres.map((g) => g.title).join(', '),
      duration: item.duration ? formatDuration(item.duration.average) : '',
      quality: !storage.getDeviceSettingBool('support4k') && item.quality >= 2160 ? 1080 : item.quality,
      ratings: renderRatings(item),
      buttons,
      plot: item.plot || '',
      bookmarksTpl: this.controls.bookmarksTpl(),
      watchedTpl: this.controls.watchedTpl(isWatched),
      personnel: renderPersonnel(item),
    }));

    this.focusArea = 'play';
    this.updateFocus();
    this.controls.loadBookmarks(item.id);
  }

  // --- focus ---

  private updateFocus(): void {
    this.$root.find('.btn').removeClass('focused');
    this.$root.find('.detail__rating.focusable').removeClass('focused');

    if (this.focusArea === 'bookmarks') {
      this.$root.find('[data-action="bookmark"]').addClass('focused');
    } else if (this.focusArea === 'watched') {
      this.$root.find('[data-action="watched"]').addClass('focused');
    } else {
      this.$root.find('.btn').eq(0).addClass('focused');
    }
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
      case 'watched': this.handleWatchedKey(e); break;
      case 'play': this.handlePlayKey(e); break;
    }
  };

  private handleBookmarksKey(e: JQuery.Event): void {
    switch (e.keyCode) {
      case TvKey.Left: this.controls.prevFolder(); e.preventDefault(); break;
      case TvKey.Right: this.controls.nextFolder(); e.preventDefault(); break;
      case TvKey.Down: this.focusArea = 'watched'; this.updateFocus(); e.preventDefault(); break;
      case TvKey.Enter: this.controls.toggleBookmark(); e.preventDefault(); break;
    }
  }

  private handleWatchedKey(e: JQuery.Event): void {
    switch (e.keyCode) {
      case TvKey.Up: this.focusArea = 'bookmarks'; this.updateFocus(); e.preventDefault(); break;
      case TvKey.Down: this.focusArea = 'play'; this.updateFocus(); e.preventDefault(); break;
      case TvKey.Enter:
        if (this.item) this.controls.toggleWatchedStatus(this.item.id, 1);
        e.preventDefault(); break;
    }
  }

  private handlePlayKey(e: JQuery.Event): void {
    switch (e.keyCode) {
      case TvKey.Up: this.focusArea = 'watched'; this.updateFocus(); e.preventDefault(); break;
      case TvKey.Enter:
        if (this.item) router.navigateMoviePlayer(this.item.id);
        e.preventDefault(); break;
    }
  }

  // --- Page ---

  mount(params: RouteParams): void {
    this.item = null;
    this.watching = null;
    this.controls.reset();
    PageUtils.showSpinnerIn(this.$root);

    loadItemWithWatching(params.id!,
      (item, watching) => {
        this.item = item;
        this.watching = watching;
        this.render();
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

export const moviePage = new MoviePage();
