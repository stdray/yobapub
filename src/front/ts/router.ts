import $ from 'jquery';
import { RouteName, RouteParams, Page } from './types/app';
import { storage } from './utils/storage';

type AfterNavigateCallback = (route: RouteName) => void;

interface ItemLike {
  readonly id: number;
  readonly type: string;
}

class Router {
  private readonly pages: Record<string, Page> = {};
  private currentRoute: RouteName | null = null;
  private currentParams: RouteParams = {};
  private readonly navHistory: Array<{ route: RouteName; params: RouteParams }> = [];
  private readonly afterCallbacks: AfterNavigateCallback[] = [];
  private exitHandler: (() => void) | null = null;

  readonly onAfterNavigate = (cb: AfterNavigateCallback): void => {
    this.afterCallbacks.push(cb);
  };

  private readonly fireAfterNavigate = (route: RouteName): void => {
    for (let i = 0; i < this.afterCallbacks.length; i++) {
      this.afterCallbacks[i](route);
    }
  };

  readonly registerPage = (name: RouteName, page: Page): void => {
    this.pages[name] = page;
  };

  private readonly navigate = (route: RouteName, params?: RouteParams): void => {
    if (this.currentRoute) {
      this.pages[this.currentRoute].unmount();
      $('#page-' + this.currentRoute).addClass('hidden');
      this.navHistory.push({ route: this.currentRoute, params: this.currentParams });
    }

    this.currentRoute = route;
    this.currentParams = params || {};
    this.fireAfterNavigate(route);
    $('#page-' + route).removeClass('hidden');
    this.pages[route].mount(this.currentParams);
  };

  readonly setExitHandler = (fn: () => void): void => {
    this.exitHandler = fn;
  };

  readonly triggerExit = (): void => {
    if (this.exitHandler) this.exitHandler();
  };

  readonly goBack = (): boolean => {
    if (this.navHistory.length === 0) {
      if (this.exitHandler) this.exitHandler();
      return false;
    }

    if (this.currentRoute) {
      this.pages[this.currentRoute].unmount();
      $('#page-' + this.currentRoute).addClass('hidden');
    }

    const prev = this.navHistory.pop()!;
    this.currentRoute = prev.route;
    this.fireAfterNavigate(prev.route);
    $('#page-' + prev.route).removeClass('hidden');
    this.pages[prev.route].mount(prev.params);
    return true;
  };

  readonly setParams = (params: RouteParams): void => {
    this.currentParams = params;
  };

  readonly getCurrentRoute = (): RouteName | null => this.currentRoute;

  // --- Simple page navigation ---

  readonly navigateLogin = (): void => { this.navigate('login'); };
  readonly navigateWatching = (): void => { this.navigate('watching'); };
  readonly navigateNovelties = (): void => { this.navigate('novelties'); };
  readonly navigateBookmarks = (): void => { this.navigate('bookmarks'); };
  readonly navigateHistory = (): void => { this.navigate('history'); };
  readonly navigateTv = (): void => { this.navigate('tv'); };
  readonly navigateSearch = (): void => { this.navigate('search'); };
  readonly navigateSettings = (): void => { this.navigate('settings'); };

  readonly navigateStartPage = (route: RouteName): void => { this.navigate(route); };

  /** Navigate back to the user's start page, clearing intermediate history */
  readonly navigateToStartPage = (): void => {
    if (this.currentRoute) {
      this.pages[this.currentRoute].unmount();
      $('#page-' + this.currentRoute).addClass('hidden');
    }
    this.navHistory.length = 0;
    this.currentRoute = null;
    this.currentParams = {};
    this.navigateStartPage(storage.getStartPage());
  };

  // --- Parameterized navigation ---

  readonly navigateItem = (item: ItemLike, episodeId?: number): void => {
    const isSerial = item.type === 'serial' || item.type === 'docuserial';
    this.navigate(isSerial ? 'serial' : 'movie', { id: item.id, episodeId });
  };

  readonly navigateSerial = (id: number, episodeId?: number): void => {
    this.navigate('serial', { id, episodeId });
  };

  readonly navigateMovie = (id: number): void => {
    this.navigate('movie', { id });
  };

  readonly navigateMoviePlayer = (id: number): void => {
    this.navigate('player', { id, video: 1 });
  };

  readonly navigateSerialPlayer = (id: number, season: number, episode: number): void => {
    this.navigate('player', { id, season, episode });
  };

  readonly navigateTvPlayer = (channelId: number, channelTitle: string, channelStream: string): void => {
    this.navigate('tv-player', { channelId, channelTitle, channelStream });
  };
}

export const router = new Router();
