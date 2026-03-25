import { apiGetWithRefresh } from './client';

export function getItem(id: number): JQueryDeferred<any> {
  return apiGetWithRefresh('/v1/items/' + id);
}
