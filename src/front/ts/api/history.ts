import { apiGetWithRefresh } from './client';

export function getHistory(page?: number): JQueryDeferred<any> {
  const params: Record<string, number> = { perpage: 20 };
  if (page) { params.page = page; }
  return apiGetWithRefresh('/v1/history', params);
}
