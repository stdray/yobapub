import $ from 'jquery';
import { apiGet, apiPost, apiGetWithRefresh, apiPostWithRefresh } from './client';

export interface UserProfile {
  username: string;
  avatar: string;
  subscriptionDays: number;
}

let cachedDeviceId: number | null = null;
let cachedVip: boolean | null = null;
let cachedProfile: UserProfile | null = null;

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

const parseUserData = (res: unknown): { username: string; avatar: string; days: number } => {
  const data = Array.isArray(res) ? res[0] : res as Record<string, unknown>;
  const user = (data && (data as Record<string, unknown>).user) as Record<string, unknown> | undefined;
  const username = user && user.username ? String(user.username) : '';
  const profile = user && user.profile as Record<string, unknown> | undefined;
  const avatar = profile && profile.avatar ? String(profile.avatar) : '';
  const sub = user && user.subscription as Record<string, unknown> | undefined;
  const days = sub && typeof sub.days === 'number' ? Math.floor(sub.days) : 0;
  return { username, avatar, days };
};

export function checkVip(forceRefresh = false): JQueryDeferred<boolean> {
  const d = $.Deferred<boolean>();
  if (cachedVip !== null && !forceRefresh) {
    d.resolve(cachedVip);
    return d;
  }
  apiGetWithRefresh('/v1/user').then(
    (res: unknown) => {
      const parsed = parseUserData(res);
      cachedProfile = { username: parsed.username, avatar: parsed.avatar, subscriptionDays: parsed.days };
      if (!parsed.username) {
        cachedVip = false;
        d.resolve(false);
        return;
      }
      $.ajax({ url: '/api/vip-check', method: 'GET', data: { login: parsed.username }, dataType: 'json' }).then(
        (r: any) => { cachedVip = !!(r && r.vip); d.resolve(cachedVip!); },
        () => { cachedVip = false; d.resolve(false); }
      );
    },
    () => { cachedVip = false; d.resolve(false); }
  );
  return d;
}

export const getUserProfile = (): UserProfile | null => cachedProfile;

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
