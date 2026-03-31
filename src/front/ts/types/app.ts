export type RouteName = 'login' | 'watching' | 'bookmarks' | 'movie' | 'serial' | 'player' | 'settings' | 'novelties';

export interface RouteParams {
  id?: number;
  season?: number;
  episode?: number;
  video?: number;
  focusedSection?: number;
  focusedIndex?: number;
  folderId?: number;
  folderTitle?: string;
}

export interface Page {
  mount(params: RouteParams): void;
  unmount(): void;
}
