import { apiGetWithRefresh } from './client';

export function getTvChannels(): JQueryDeferred<any> {
  return apiGetWithRefresh('/v1/tv');
}
