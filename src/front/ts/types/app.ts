export type RouteName = 'login' | 'watching' | 'bookmarks' | 'movie' | 'serial' | 'player' | 'settings';

export interface RouteParams {
  id?: number;
  season?: number;
  episode?: number;
  video?: number;
  mid?: number;
  focusedSection?: number;
  focusedIndex?: number;
  folderId?: number;
  folderTitle?: string;
}

export interface Page {
  mount(params: RouteParams): void;
  unmount(): void;
}
