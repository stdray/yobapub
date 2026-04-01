import $ from 'jquery';
import { apiClient } from './client';
import { Item, ItemResponse, ItemsResponse, WatchingInfoItem, WatchingInfoResponse } from '../types/api';
import { getWatchingInfo } from './watching';

export const getItem = (id: number): JQueryDeferred<ItemResponse> =>
  apiClient.apiGetWithRefresh('/v1/items/' + id);

export const getItems = (type: string, sort?: string): JQueryDeferred<ItemsResponse> => {
  const params: Record<string, string> = { type: type };
  if (sort) params.sort = sort;
  return apiClient.apiGetWithRefresh('/v1/items', params);
};

export const searchItems = (query: string, page?: number, perpage?: number): JQueryDeferred<ItemsResponse> => {
  const params: Record<string, string | number> = { q: query, field: 'title' };
  if (page !== undefined) params.page = page;
  if (perpage !== undefined) params.perpage = perpage;
  return apiClient.apiGetWithRefresh('/v1/items/search', params);
};

export const loadItemWithWatching = (
  id: number,
  onSuccess: (item: Item, watching: WatchingInfoItem | null) => void,
  onError: () => void
): void => {
  $.when(getItem(id), getWatchingInfo(id)).then(
    (itemRes: any, watchRes: any) => {
      const iData = Array.isArray(itemRes) ? itemRes[0] : itemRes;
      const wData = Array.isArray(watchRes) ? watchRes[0] : watchRes;
      const item: Item = iData.item;
      const watching: WatchingInfoItem | null = (wData && wData.item) || null;
      if (item) { onSuccess(item, watching); }
      else { onError(); }
    },
    () => { onError(); }
  );
};
