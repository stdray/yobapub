import $ from 'jquery';
import { RouteName, RouteParams, Page } from './types/app';

const pages: Record<string, Page> = {};
let currentRoute: RouteName | null = null;
let currentParams: RouteParams = {};
const history: Array<{ route: RouteName; params: RouteParams }> = [];

export function registerPage(name: RouteName, page: Page): void {
  pages[name] = page;
}

export function navigate(route: RouteName, params?: RouteParams): void {
  if (currentRoute) {
    pages[currentRoute].unmount();
    $('#page-' + currentRoute).addClass('hidden');
    history.push({ route: currentRoute, params: currentParams });
  }

  currentRoute = route;
  currentParams = params || {};
  $('#page-' + route).removeClass('hidden');
  pages[route].mount(currentParams);
}

let exitHandler: (() => void) | null = null;

export function setExitHandler(fn: () => void): void {
  exitHandler = fn;
}

export function goBack(): boolean {
  if (history.length === 0) {
    if (exitHandler) exitHandler();
    return false;
  }

  if (currentRoute) {
    pages[currentRoute].unmount();
    $('#page-' + currentRoute).addClass('hidden');
  }

  const prev = history.pop()!;
  currentRoute = prev.route;
  $('#page-' + prev.route).removeClass('hidden');
  pages[prev.route].mount(prev.params);
  return true;
}

export function setParams(params: RouteParams): void {
  currentParams = params;
}

export function getCurrentRoute(): RouteName | null {
  return currentRoute;
}


