import $ from 'jquery';
import { apiGetWithRefresh } from './client';
import { Item, ItemsResponse, WatchingInfoItem } from '../types/api';
import { getWatchingInfo } from './watching';

export function getItem(id: number): JQueryDeferred<any> {
  return apiGetWithRefresh('/v1/items/' + id);
}

export function getItems(type: string, sort?: string): JQueryDeferred<any> {
  var params: Record<string, any> = { type: type };
  if (sort) params.sort = sort;
  return apiGetWithRefresh('/v1/items', params);
}

export function searchItems(query: string, page?: number, perpage?: number): JQueryDeferred<ItemsResponse> {
  var params: Record<string, string | number> = { q: query, field: 'title' };
  if (page !== undefined) params.page = page;
  if (perpage !== undefined) params.perpage = perpage;
  return apiGetWithRefresh('/v1/items/search', params);
}

export function loadItemWithWatching(
  id: number,
  onSuccess: (item: Item, watching: WatchingInfoItem | null) => void,
  onError: () => void
): void {
  $.when(getItem(id), getWatchingInfo(id)).then(
    function (itemRes: any, watchRes: any) {
      var iData = Array.isArray(itemRes) ? itemRes[0] : itemRes;
      var wData = Array.isArray(watchRes) ? watchRes[0] : watchRes;
      var item: Item = iData.item;
      var watching: WatchingInfoItem | null = (wData && wData.item) || null;
      if (item) { onSuccess(item, watching); }
      else { onError(); }
    },
    function () { onError(); }
  );
}
