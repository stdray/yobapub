import $ from 'jquery';
import { apiGet, apiPost, apiGetWithRefresh, apiPostWithRefresh } from './client';

let cachedDeviceId: number | null = null;
let cachedVip: boolean | null = null;

export function getCurrentDeviceInfo(): JQueryDeferred<any> {
  return apiGetWithRefresh('/v1/device/info');
}

export function getDeviceId(): JQueryDeferred<number> {
  let d = $.Deferred<number>();
  if (cachedDeviceId) {
    d.resolve(cachedDeviceId);
    return d;
  }
  getCurrentDeviceInfo().then(
    function (res: any) {
      const data = Array.isArray(res) ? res[0] : res;
      if (data && data.device && data.device.id) {
        cachedDeviceId = data.device.id;
        d.resolve(cachedDeviceId!);
      } else {
        d.reject();
      }
    },
    function () { d.reject(); }
  );
  return d;
}

export function getDeviceSettings(): JQueryDeferred<any> {
  let d = $.Deferred();
  getDeviceId().then(
    function (id: number) {
      apiGetWithRefresh('/v1/device/' + id + '/settings').then(
        function (res: any) { d.resolve(res); },
        function (err: any) { d.reject(err); }
      );
    },
    function () { d.reject(); }
  );
  return d;
}

export function unlinkDevice(): JQueryDeferred<any> {
  return apiPostWithRefresh('/v1/device/unlink');
}

export function checkVip(): JQueryDeferred<boolean> {
  const d = $.Deferred<boolean>();
  if (cachedVip !== null) {
    d.resolve(cachedVip);
    return d;
  }
  apiGetWithRefresh('/v1/user').then(
    (res: any) => {
      const data = Array.isArray(res) ? res[0] : res;
      const login = data && data.user && data.user.login ? String(data.user.login) : '';
      if (!login) {
        cachedVip = false;
        d.resolve(false);
        return;
      }
      $.ajax({ url: '/api/vip-check', method: 'GET', data: { login }, dataType: 'json' }).then(
        (r: any) => { cachedVip = !!(r && r.vip); d.resolve(cachedVip!); },
        () => { cachedVip = false; d.resolve(false); }
      );
    },
    () => { cachedVip = false; d.resolve(false); }
  );
  return d;
}

export function saveDeviceSettings(settings: Record<string, any>): JQueryDeferred<any> {
  let d = $.Deferred();
  getDeviceId().then(
    function (id: number) {
      apiPost('/v1/device/' + id + '/settings', settings).then(
        function (res: any) { d.resolve(res); },
        function (err: any) { d.reject(err); }
      );
    },
    function () { d.reject(); }
  );
  return d;
}
