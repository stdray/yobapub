import $ from 'jquery';
import * as doT from 'dot';
import { RouteParams } from '../types/app';
import { TvChannel, TvChannelsResponse } from '../types/api';
import { router } from '../router';
import { TvKey } from '../utils/platform';
import { PageUtils } from '../utils/page';
import { gridMove } from '../utils/grid';
import { storage } from '../utils/storage';
import { getTvChannels } from '../api/tv';
import { tplEmptyText } from '../utils/templates';
import { sidebar } from '../sidebar';
import { SidebarPage } from './sidebar-page';

const tplChannelCardCompiled = doT.template(`
  <div class="card card--channel" data-id="{{=it.id}}">
    <div class="card__poster card__poster--channel">
      <img src="{{=it.logo}}" alt="">
    </div>
    <div class="card__title">{{=it.title}}</div>
  </div>
`);

const tplChannelCard = (data: { readonly id: number; readonly logo: string; readonly title: string }): string =>
  tplChannelCardCompiled(data);

const tplPageCompiled = doT.template(`
  <div class="content"><div class="watching">
    <div class="watching__section-title">Телеканалы</div>
    <div class="watching__grid">{{=it.cards}}</div>
  </div></div>
`);

const tplPage = (data: { readonly cards: string }): string =>
  tplPageCompiled(data);

class TvPage extends SidebarPage {
  private channels: TvChannel[] = [];
  private focusedIndex = 0;

  constructor() { super('tv'); }

  protected onUnfocus(): void { this.updateFocus(); }

  protected onMount(params: RouteParams): void {
    this.focusedIndex = typeof params.tvFocusedIndex === 'number' ? params.tvFocusedIndex : 0;
    PageUtils.showSpinnerIn(this.$root);
    getTvChannels().then(
      (res: TvChannelsResponse) => {
        this.channels = (res && res.channels) || [];
        if (this.focusedIndex >= this.channels.length) this.focusedIndex = 0;
        this.render();
      },
      () => {
        this.$root.html('<div class="content"><div class="watching">' + tplEmptyText({ text: 'Ошибка загрузки' }) + '</div></div>');
      }
    );
  }

  protected onUnmount(): void {
    this.channels = [];
  }

  protected handleKey(e: JQuery.Event): void {
    if (this.channels.length === 0) { sidebar.handleEmptyState(e); return; }

    const dir =
      e.keyCode === TvKey.Right ? 'right' as const :
      e.keyCode === TvKey.Left  ? 'left'  as const :
      e.keyCode === TvKey.Down  ? 'down'  as const :
      e.keyCode === TvKey.Up    ? 'up'    as const :
      null;

    if (dir !== null) {
      if (dir === 'left') {
        const nl = sidebar.gridLeftOrFocus(this.focusedIndex, this.channels.length);
        if (nl >= 0) { this.focusedIndex = nl; this.updateFocus(); }
      } else {
        const next = gridMove(this.focusedIndex, this.channels.length, dir);
        if (next >= 0) { this.focusedIndex = next; this.updateFocus(); }
      }
      e.preventDefault();
      return;
    }

    switch (e.keyCode) {
      case TvKey.Enter:
        if (this.channels.length > 0) {
          const ch = this.channels[this.focusedIndex];
          router.setParams({ tvFocusedIndex: this.focusedIndex });
          router.navigateTvPlayer(ch.id, ch.title, ch.stream);
        }
        e.preventDefault(); break;
      default: sidebar.backOrFocus(e);
    }
  }

  private render(): void {
    if (this.channels.length === 0) {
      this.$root.html('<div class="content"><div class="watching">' + tplEmptyText({ text: 'Нет каналов' }) + '</div></div>');
      return;
    }
    let cards = '';
    for (let i = 0; i < this.channels.length; i++) {
      cards += tplChannelCard({
        id: this.channels[i].id,
        logo: storage.proxyPosterUrl(this.channels[i].logos.s),
        title: this.channels[i].title
      });
    }
    this.$root.html(tplPage({ cards: cards }));
    this.updateFocus();
  }

  private updateFocus(): void {
    this.$root.find('.card').removeClass('focused');
    const $cards = this.$root.find('.card');
    if ($cards.length > 0 && this.focusedIndex < $cards.length) {
      const $card = $cards.eq(this.focusedIndex);
      $card.addClass('focused');
      PageUtils.scrollIntoView($card[0], this.$root.find('.watching')[0]);
    }
  }
}

export const tvPage = new TvPage();
