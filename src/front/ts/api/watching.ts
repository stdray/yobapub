import { apiClient } from './client';
import { WatchingMoviesResponse, WatchingSerialsResponse, WatchingInfoResponse, WatchlistToggleResponse } from '../types/api';

export const getWatchingMovies = (): JQueryDeferred<WatchingMoviesResponse> =>
  apiClient.apiGetWithRefresh('/v1/watching/movies');

export const getWatchingSerials = (): JQueryDeferred<WatchingSerialsResponse> =>
  apiClient.apiGetWithRefresh('/v1/watching/serials', { subscribed: 1 });

export const getWatchingInfo = (id: number): JQueryDeferred<WatchingInfoResponse> =>
  apiClient.apiGetWithRefresh('/v1/watching', { id: id });

export const markTime = (id: number, video: number, time: number, season?: number): JQueryDeferred<void> => {
  const params: Record<string, number> = { id: id, video: video, time: time };
  if (season !== undefined) {
    params.season = season;
  }
  return apiClient.apiGetWithRefresh('/v1/watching/marktime', params);
};

export const toggleWatched = (id: number, video: number, season?: number): JQueryDeferred<void> => {
  const params: Record<string, number> = { id: id, video: video };
  if (season !== undefined) {
    params.season = season;
  }
  return apiClient.apiGetWithRefresh('/v1/watching/toggle', params);
};

export const toggleWatchlist = (id: number): JQueryDeferred<WatchlistToggleResponse> =>
  apiClient.apiGetWithRefresh('/v1/watching/togglewatchlist', { id: id });
