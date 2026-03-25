import { apiGetWithRefresh } from './client';

export function getWatchingMovies(): JQueryDeferred<any> {
  return apiGetWithRefresh('/v1/watching/movies');
}

export function getWatchingSerials(): JQueryDeferred<any> {
  return apiGetWithRefresh('/v1/watching/serials', { subscribed: 1 });
}

export function getWatchingInfo(id: number): JQueryDeferred<any> {
  return apiGetWithRefresh('/v1/watching', { id: id });
}

export function markTime(id: number, video: number, time: number, season?: number): JQueryDeferred<any> {
  var params: Record<string, any> = { id: id, video: video, time: time };
  if (season !== undefined) {
    params.season = season;
  }
  return apiGetWithRefresh('/v1/watching/marktime', params);
}
