import $ from 'jquery';
import * as doT from 'dot';
import { RouteName } from './types/app';
import { navigate, goBack } from './router';
import { TvKey } from './utils/platform';
import { clearTokens, proxyPosterUrl } from './utils/storage';
import { unlinkDevice, getUserProfile } from './api/device';
import { gridMove } from './utils/grid';

const MENU_ITEMS = ['Новинки', 'Я смотрю', 'История', 'Закладки', 'ТВ', 'Поиск', 'Настройки', 'Выход'];

const MENU_ROUTES: ReadonlyArray<RouteName | null> = [
  'novelties', 'watching', 'history', 'bookmarks', 'tv', 'search', 'settings', null
];

const ROUTE_TO_MENU: Readonly<Record<string, number>> = {
  novelties: 0, watching: 1, history: 2, bookmarks: 3, tv: 4, search: 5, settings: 6
};

const SIDEBAR_ROUTES: ReadonlyArray<RouteName> = [
  'watching', 'novelties', 'history', 'bookmarks', 'tv', 'search', 'settings'
];

const DOUBLE_BACK_MS = 3000;

const tplCompiled = doT.template(`
  {{?it.profile}}
    <div class="sidebar__profile">
      <img class="sidebar__avatar" src="{{=it.profile.avatar}}" />
      <div class="sidebar__username">{{=it.profile.username}}</div>
      <div class="sidebar__sub">{{=it.profile.days}} дн.</div>
    </div>
  {{?}}
  {{~it.items :item:idx}}
    <div class="sidebar__item{{?item.active}} active{{?}}{{?item.focused}} focused{{?}}" data-menu="{{=idx}}">{{=item.label}}</div>
  {{~}}
`);

class Sidebar {
  private readonly $el = $('#sidebar');
  private menuIndex = 0;
  private focused = false;
  private activeRoute: RouteName | null = null;
  private onUnfocus: (() => void) | null = null;
  private lastBackTime = 0;

  show(route: RouteName): void {
    this.activeRoute = route;
    this.menuIndex = ROUTE_TO_MENU[route] ?? 0;
    this.focused = false;
    this.$el.removeClass('hidden');
    this.render();
  }

  hide(): void {
    this.$el.addClass('hidden');
    this.focused = false;
    this.onUnfocus = null;
  }

  refresh(): void {
    if (!this.$el.hasClass('hidden')) this.render();
  }

  isRoute(route: RouteName): boolean {
    return SIDEBAR_ROUTES.indexOf(route) >= 0;
  }

  focus(): void {
    this.focused = true;
    this.updateFocus();
  }

  setUnfocusHandler(handler: (() => void) | null): void {
    this.onUnfocus = handler;
  }

  /** Wraps a page key handler — delegates to sidebar when it has focus */
  wrapKeys(handler: (e: JQuery.Event) => void): (e: JQuery.Event) => void {
    return (e: JQuery.Event): void => {
      if (this.focused) { this.handleKey(e); return; }
      handler(e);
    };
  }

  /** Handles Left/Back keys when page has no content — redirects to sidebar */
  handleEmptyState(e: JQuery.Event): boolean {
    switch (e.keyCode) {
      case TvKey.Left:
      case TvKey.Return:
      case TvKey.Backspace:
      case TvKey.Escape:
        this.focus();
        e.preventDefault();
        return true;
    }
    return false;
  }

  /** Grid left movement with sidebar fallback. Returns new index or -1 (sidebar got focus). */
  gridLeftOrFocus(index: number, total: number): number {
    const next = gridMove(index, total, 'left');
    if (next < 0) this.focus();
    return next;
  }

  /** Focuses sidebar on Back keys (Return/Backspace/Escape) */
  backOrFocus(e: JQuery.Event): boolean {
    switch (e.keyCode) {
      case TvKey.Return:
      case TvKey.Backspace:
      case TvKey.Escape:
        this.focus();
        e.preventDefault();
        return true;
    }
    return false;
  }

  private render(): void {
    const up = getUserProfile();
    const profile = up && up.avatar
      ? { avatar: proxyPosterUrl(up.avatar), username: up.username, days: up.subscriptionDays }
      : null;
    this.$el.html(tplCompiled({ items: this.buildItems(), profile: profile }));
  }

  private buildItems(): ReadonlyArray<{ readonly label: string; readonly active: boolean; readonly focused: boolean }> {
    const activeIdx = this.activeRoute ? (ROUTE_TO_MENU[this.activeRoute] ?? -1) : -1;
    const items = [];
    for (let i = 0; i < MENU_ITEMS.length; i++) {
      items.push({
        label: MENU_ITEMS[i],
        active: i === activeIdx,
        focused: this.focused && i === this.menuIndex
      });
    }
    return items;
  }

  private updateFocus(): void {
    this.$el.find('.sidebar__item').removeClass('focused');
    if (this.focused) {
      this.$el.find('.sidebar__item').eq(this.menuIndex).addClass('focused');
    }
  }

  private unfocus(): void {
    this.focused = false;
    this.updateFocus();
    if (this.onUnfocus) this.onUnfocus();
  }

  private handleKey(e: JQuery.Event): void {
    switch (e.keyCode) {
      case TvKey.Up:
        if (this.menuIndex > 0) { this.menuIndex--; this.updateFocus(); }
        e.preventDefault(); break;
      case TvKey.Down:
        if (this.menuIndex < MENU_ITEMS.length - 1) { this.menuIndex++; this.updateFocus(); }
        e.preventDefault(); break;
      case TvKey.Right:
        this.unfocus();
        e.preventDefault(); break;
      case TvKey.Enter: {
        const route = MENU_ROUTES[this.menuIndex];
        if (route) {
          if (route !== this.activeRoute) {
            navigate(route);
          } else {
            this.unfocus();
          }
        } else if (this.menuIndex === 7) {
          unlinkDevice().always(() => { clearTokens(); navigate('login'); });
        }
        e.preventDefault(); break;
      }
      case TvKey.Return:
      case TvKey.Backspace:
      case TvKey.Escape: {
        if (this.activeRoute === 'watching') {
          const now = Date.now();
          if (now - this.lastBackTime < DOUBLE_BACK_MS) {
            this.lastBackTime = 0;
            goBack();
          } else {
            this.lastBackTime = now;
          }
        } else {
          goBack();
        }
        e.preventDefault(); break;
      }
    }
  }
}

export const sidebar = new Sidebar();
