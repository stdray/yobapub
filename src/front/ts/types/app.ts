export type RouteName = 'login' | 'watching' | 'bookmarks' | 'movie' | 'serial' | 'player' | 'settings' | 'novelties' | 'search' | 'tv' | 'tv-player' | 'history' | 'test-player';

export interface RouteParams {
  id?: number;
  season?: number;
  episode?: number;
  video?: number;
  focusedSection?: number;
  focusedIndex?: number;
  typeTab?: number;
  categoryTab?: number;
  folderId?: number;
  folderTitle?: string;
  searchQuery?: string;
  channelId?: number;
  channelTitle?: string;
  channelStream?: string;
  tvFocusedIndex?: number;
  historyPage?: number;
  historyFocusedIndex?: number;
  episodeId?: number;
  _searchState?: unknown;
}

export interface Page {
  mount(params: RouteParams): void;
  unmount(): void;
}
