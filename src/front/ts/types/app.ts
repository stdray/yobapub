export type RouteName = 'login' | 'watching' | 'bookmarks' | 'movie' | 'serial' | 'player' | 'settings' | 'novelties' | 'search' | 'tv' | 'tv-player';

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
  channelId?: number;
  channelTitle?: string;
  channelStream?: string;
  tvFocusedIndex?: number;
}

export interface Page {
  mount(params: RouteParams): void;
  unmount(): void;
}
