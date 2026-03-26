export type RouteName = 'login' | 'watching' | 'movie' | 'serial' | 'player' | 'settings';

export interface RouteParams {
  id?: number;
  season?: number;
  episode?: number;
  video?: number;
  focusedSection?: number;
  focusedIndex?: number;
}

export interface Page {
  mount(params: RouteParams): void;
  unmount(): void;
}
