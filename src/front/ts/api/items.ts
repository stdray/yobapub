import { apiClient } from './client';
import { Item, ItemResponse, ItemsResponse, WatchingInfoItem, WatchingInfoResponse } from '../types/api';
import { getWatchingInfo } from './watching';

export const getItem = (id: number): JQueryDeferred<ItemResponse> =>
  apiClient.apiGetWithRefresh('/v1/items/' + id);

export const getItems = (type: string, sort?: string): JQueryDeferred<ItemsResponse> =>
  apiClient.apiGetWithRefresh('/v1/items', sort ? { type, sort } : { type });

export const searchItems = (
  query: string, page?: number, perpage?: number
): JQueryDeferred<ItemsResponse> => {
  const params: { q: string; field: string; page?: number; perpage?: number } = { q: query, field: 'title' };
  if (page !== undefined) params.page = page;
  if (perpage !== undefined) params.perpage = perpage;
  return apiClient.apiGetWithRefresh('/v1/items/search', params);
};

export const loadItemWithWatching = (
  id: number,
  onSuccess: (item: Item, watching: WatchingInfoItem | null) => void,
  onError: () => void
): void => {
  getItem(id).then(
    (itemData: ItemResponse) => {
      const item = itemData.item;
      if (!item) { onError(); return; }
      getWatchingInfo(id).then(
        (watchData: WatchingInfoResponse) => {
          const watching: WatchingInfoItem | null = (watchData && watchData.item) || null;
          onSuccess(item, watching);
        },
        () => { onSuccess(item, null); }
      );
    },
    () => { onError(); }
  );
};
