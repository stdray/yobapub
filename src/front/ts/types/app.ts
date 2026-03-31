export type RouteName = 'login' | 'watching' | 'bookmarks' | 'movie' | 'serial' | 'player' | 'settings' | 'novelties' | 'search';

export interface RouteParams {
  id?: number;
  season?: number;
  episode?: number;
  video?: number;
  focusedSection?: number;
  focusedIndex?: number;
  folderId?: number;
  folderTitle?: string;
  searchQuery?: string;
}

export interface Page {
  mount(params: RouteParams): void;
  unmount(): void;
}
