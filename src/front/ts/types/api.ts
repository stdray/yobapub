export interface DeviceCodeResponse {
  code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
}

export interface AuthErrorResponse {
  error: string;
  error_description?: string;
}

export interface Poster {
  small: string;
  medium: string;
  big: string;
}

export interface Genre {
  id: number;
  title: string;
}

export interface Country {
  id: number;
  title: string;
}

export interface VideoFile {
  w: number;
  h: number;
  quality: string;
  codec?: string;
  quality_id?: number;
  file?: string;
  url?: {
    http: string;
    hls: string;
    hls2?: string;
    hls4?: string;
  };
  urls?: {
    http: string;
    hls: string;
    hls2?: string;
    hls4?: string;
  };
}

export interface AudioTrack {
  id: number;
  index: number;
  codec: string;
  channels: number;
  lang: string;
  type: { id: number; title: string; short_title: string | null };
  author: { id: number; title: string; short_title: string | null };
}

export interface Subtitle {
  lang: string;
  shift: number;
  embed: boolean;
  forced?: boolean;
  url: string;
}

export interface WatchingStatus {
  status: number;
  time: number;
}

export interface Video {
  id: number;
  title: string;
  thumbnail: string;
  duration: number;
  watched: number;
  watching: WatchingStatus;
  number?: number;
  tracks?: string;
  subtitles?: Subtitle[];
  audios?: AudioTrack[];
  files: VideoFile[];
}

export interface Episode {
  id: number;
  title: string;
  thumbnail?: string;
  duration: number;
  number: number;
  snumber?: number;
  audios?: AudioTrack[];
  subtitles?: Subtitle[];
  files: VideoFile[];
  watching?: WatchingStatus;
}

export interface Season {
  title: string;
  number: number;
  episodes: Episode[];
}

export interface Trailer {
  id: string;
  url: string;
}

export interface ItemDuration {
  average: number;
  total: number;
}

export interface Item {
  id: number;
  title: string;
  type: string;
  subtype: string;
  year: number;
  cast: string;
  director: string;
  voice?: string;
  duration: ItemDuration;
  langs: number;
  quality: number;
  genres: Genre[];
  countries: Country[];
  plot: string;
  imdb: number;
  imdb_rating: number;
  imdb_votes: number;
  kinopoisk: number;
  kinopoisk_rating: number;
  kinopoisk_votes: number;
  rating: number;
  views: number;
  finished: boolean;
  advert: boolean;
  in_watchlist: boolean;
  subscribed: boolean;
  posters: Poster;
  trailer?: Trailer;
  videos?: Video[];
  seasons?: Season[];
}

export interface ItemResponse {
  item: Item;
}

export interface Pagination {
  total: number;
  current: number;
  perpage: number;
}

export interface ItemsResponse {
  items: Item[];
  pagination: Pagination;
}

export interface WatchingMovieItem {
  id: number;
  type: string;
  subtype: string;
  title: string;
  posters: Poster;
}

export interface WatchingSerialItem {
  id: number;
  type: string;
  subtype: string;
  title: string;
  posters: Poster;
  total: number;
  watched: number;
  new: number;
}

export interface WatchingMoviesResponse {
  status: number;
  items: WatchingMovieItem[];
}

export interface WatchingSerialsResponse {
  status: number;
  items: WatchingSerialItem[];
}

export interface WatchingInfoEpisode {
  id: number;
  number: number;
  title: string;
  duration: number;
  time: number;
  status: number;
  updated: number;
}

export interface WatchingInfoSeason {
  id: number;
  number: number;
  status: number;
  episodes: WatchingInfoEpisode[];
}

export interface WatchingInfoItem {
  id: number;
  title: string;
  type: string;
  seasons?: WatchingInfoSeason[];
  videos?: WatchingInfoEpisode[];
}

export interface WatchingInfoResponse {
  status: number;
  item: WatchingInfoItem;
}

export interface BookmarkFolder {
  id: number;
  title: string;
  count: number;
  views: number;
}

export interface BookmarkFoldersResponse {
  status: number;
  items: BookmarkFolder[];
}

export interface BookmarkItemsResponse {
  status: number;
  items: Item[];
  pagination: Pagination;
}

export interface BookmarkItemFoldersResponse {
  status: number;
  folders: BookmarkFolder[];
}

export interface BookmarkToggleResponse {
  status: number;
}

export interface WatchlistToggleResponse {
  status: number;
  watching: boolean;
}

export interface TvChannel {
  readonly id: number;
  readonly title: string;
  readonly logos: {
    readonly s: string;
  };
  readonly stream: string;
}

export interface TvChannelsResponse {
  readonly channels: TvChannel[];
}

export interface HistoryMedia {
  readonly id: number;
  readonly title: string;
  readonly number?: number;
  readonly snumber?: number;
  readonly duration: number;
  readonly thumbnail?: string;
}

export interface HistoryEntry {
  readonly time: number;
  readonly counter: number;
  readonly first_seen: number;
  readonly last_seen: number;
  readonly item: Item;
  readonly media: HistoryMedia;
}

export interface HistoryResponse {
  readonly history: HistoryEntry[];
  readonly pagination: Pagination;
}

export interface DeviceInfoResponse {
  readonly device: {
    readonly id: number;
    readonly title: string;
    readonly hardware: string;
    readonly software: string;
  };
}

export interface DeviceSettingOption {
  readonly id: number | string;
  readonly label: string;
  readonly description?: string;
  readonly selected: boolean;
}

export interface DeviceSetting {
  readonly label?: string;
  readonly type: string;
  readonly value: boolean | number | ReadonlyArray<DeviceSettingOption>;
}

export interface DeviceSettingsResponse {
  readonly settings: Record<string, DeviceSetting>;
}

export interface UserResponse {
  readonly user: {
    readonly username: string;
    readonly profile?: { readonly avatar?: string };
    readonly subscription?: { readonly days?: number };
  };
}

export interface VipCheckResponse {
  readonly vip: boolean;
}

export interface MediaLinksResponse {
  readonly files: VideoFile[];
  readonly subtitles: Subtitle[];
}
