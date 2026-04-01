import { apiClient } from './client';

export function getTvChannels(): JQueryDeferred<any> {
  return apiClient.apiGetWithRefresh('/v1/tv');
}
