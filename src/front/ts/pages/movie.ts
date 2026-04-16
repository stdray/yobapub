import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { loadItemWithWatching } from '../api/items';
import { Item, WatchingInfoItem } from '../types/api';
import { router } from '../router';
import { PageKeys, PageUtils } from '../utils/page';
import { renderRatings, renderPersonnel } from '../utils/templates';
import { formatDuration } from '../utils/format';
import { storage } from '../utils/storage';
import { DetailControls } from '../utils/detail-controls';
import { Fsm, FsmDef } from '../utils/fsm';
import { DetailKeyEvent, toDetailEvent } from '../utils/platform';

// --- fsm ---

type MovieFocus = 'bookmarks' | 'watched' | 'play';

interface MovieFsmCtx {
  prevFolder(): void;
  nextFolder(): void;
  toggleBookmark(): void;
  toggleWatched(): void;
  playMovie(): void;
  goBack(): void;
}

const movieMachine: FsmDef<MovieFocus, MovieFsmCtx, DetailKeyEvent> = {
  initial: 'play',
  states: {
    bookmarks: {
      on: {
        KEY_LEFT: { action: (c) => c.prevFolder() },
        KEY_RIGHT: { action: (c) => c.nextFolder() },
        KEY_DOWN: 'watched',
        KEY_ENTER: { action: (c) => c.toggleBookmark() },
        KEY_BACK: 'play',
      },
    },
    watched: {
      on: {
        KEY_UP: 'bookmarks',
        KEY_DOWN: 'play',
        KEY_ENTER: { action: (c) => c.toggleWatched() },
        KEY_BACK: { action: (c) => c.goBack() },
      },
    },
    play: {
      on: {
        KEY_UP: 'watched',
        KEY_ENTER: { action: (c) => c.playMovie() },
        KEY_BACK: { action: (c) => c.goBack() },
      },
    },
  },
};

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

class MoviePage implements Page, MovieFsmCtx {
  private readonly $root = $('#page-movie');
  private readonly keys = new PageKeys();
  private readonly controls = new DetailControls(this.$root);

  private item: Item | null = null;
  private watching: WatchingInfoItem | null = null;
  private fsm!: Fsm<MovieFocus, MovieFsmCtx, DetailKeyEvent>;

  // --- MovieFsmCtx ---

  prevFolder(): void { this.controls.prevFolder(); }
  nextFolder(): void { this.controls.nextFolder(); }
  toggleBookmark(): void { this.controls.toggleBookmark(); }

  toggleWatched(): void {
    if (this.item) this.controls.toggleWatchedStatus(this.item.id, 1);
  }

  playMovie(): void {
    if (this.item) router.navigateMoviePlayer(this.item.id);
  }

  goBack(): void { router.goBack(); }

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

    this.updateFocus();
    this.controls.loadBookmarks(item.id);
  }

  // --- focus ---

  private updateFocus(): void {
    this.$root.find('.btn').removeClass('focused');
    this.$root.find('.detail__rating.focusable').removeClass('focused');

    if (this.fsm.state === 'bookmarks') {
      this.$root.find('[data-action="bookmark"]').addClass('focused');
    } else if (this.fsm.state === 'watched') {
      this.$root.find('[data-action="watched"]').addClass('focused');
    } else {
      this.$root.find('.btn').eq(0).addClass('focused');
    }
  }

  // --- keys ---

  private readonly handleKey = (e: JQuery.Event): void => {
    const ev = toDetailEvent(e.keyCode!);
    if (!ev) return;
    this.fsm.send(ev);
    e.preventDefault();
  };

  // --- Page ---

  mount(params: RouteParams): void {
    this.item = null;
    this.watching = null;
    this.controls.reset();
    this.fsm = new Fsm(movieMachine, this as MovieFsmCtx);
    this.fsm.setListener(() => this.updateFocus());
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
    this.fsm.stop();
    PageUtils.clearPage(this.$root);
    this.item = null;
    this.watching = null;
  }
}

export const moviePage = new MoviePage();
