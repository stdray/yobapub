import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { TvChannel } from '../types/api';
import { router } from '../router';
import { TvKey } from '../utils/platform';
import { PageKeys, PageUtils } from '../utils/page';
import { gridMove } from '../utils/grid';
import { storage } from '../utils/storage';
import { getTvChannels } from '../api/tv';
import { tplEmptyText } from '../utils/templates';
import { sidebar } from '../sidebar';

const $root = $('#page-tv');
const keys = new PageKeys();

let channels: TvChannel[] = [];
let focusedIndex = 0;

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

const updateFocus = (): void => {
  $root.find('.card').removeClass('focused');
  const $cards = $root.find('.card');
  if ($cards.length > 0 && focusedIndex < $cards.length) {
    const $card = $cards.eq(focusedIndex);
    $card.addClass('focused');
    PageUtils.scrollIntoView($card[0], $root.find('.watching')[0]);
  }
};

const render = (): void => {
  if (channels.length === 0) {
    $root.html('<div class="content"><div class="watching">' + tplEmptyText({ text: 'Нет каналов' }) + '</div></div>');
    return;
  }
  let cards = '';
  for (let i = 0; i < channels.length; i++) {
    cards += tplChannelCard({
      id: channels[i].id,
      logo: storage.proxyPosterUrl(channels[i].logos.s),
      title: channels[i].title
    });
  }
  $root.html(tplPage({ cards: cards }));
  updateFocus();
};

const handleKey = sidebar.wrapKeys((e: JQuery.Event): void => {
  if (channels.length === 0) { sidebar.handleEmptyState(e); return; }

  const dir =
    e.keyCode === TvKey.Right ? 'right' as const :
    e.keyCode === TvKey.Left  ? 'left'  as const :
    e.keyCode === TvKey.Down  ? 'down'  as const :
    e.keyCode === TvKey.Up    ? 'up'    as const :
    null;

  if (dir !== null) {
    if (dir === 'left') {
      const nl = sidebar.gridLeftOrFocus(focusedIndex, channels.length);
      if (nl >= 0) { focusedIndex = nl; updateFocus(); }
    } else {
      const next = gridMove(focusedIndex, channels.length, dir);
      if (next >= 0) { focusedIndex = next; updateFocus(); }
    }
    e.preventDefault();
    return;
  }

  switch (e.keyCode) {
    case TvKey.Enter:
      if (channels.length > 0) {
        const ch = channels[focusedIndex];
        router.setParams({ tvFocusedIndex: focusedIndex });
        router.navigate('tv-player', {
          channelId: ch.id,
          channelTitle: ch.title,
          channelStream: ch.stream
        });
      }
      e.preventDefault(); break;
    default: sidebar.backOrFocus(e);
  }
});

export const tvPage: Page = {
  mount(params: RouteParams) {
    focusedIndex = typeof params.tvFocusedIndex === 'number' ? params.tvFocusedIndex : 0;
    PageUtils.showSpinnerIn($root);
    sidebar.setUnfocusHandler(() => updateFocus());
    getTvChannels().then(
      (res: any) => {
        channels = (res && res.channels) || [];
        if (focusedIndex >= channels.length) focusedIndex = 0;
        render();
      },
      () => {
        $root.html('<div class="content"><div class="watching">' + tplEmptyText({ text: 'Ошибка загрузки' }) + '</div></div>');
      }
    );
    keys.bind(handleKey);
  },
  unmount() {
    keys.unbind();
    PageUtils.clearPage($root);
    sidebar.setUnfocusHandler(null);
    channels = [];
  }
};
