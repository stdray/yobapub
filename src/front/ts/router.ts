import $ from 'jquery';
import { RouteName, RouteParams, Page } from './types/app';

type AfterNavigateCallback = (route: RouteName) => void;

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

  readonly navigate = (route: RouteName, params?: RouteParams): void => {
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

  readonly getCurrentRoute = (): RouteName | null => {
    return this.currentRoute;
  };
}

export const router = new Router();
