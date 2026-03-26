import $ from 'jquery';
import { apiGetWithRefresh } from './client';
import { Item, WatchingInfoItem } from '../types/api';
import { getWatchingInfo } from './watching';

export function getItem(id: number): JQueryDeferred<any> {
  return apiGetWithRefresh('/v1/items/' + id);
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
