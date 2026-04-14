import $ from 'jquery';
import { apiClient } from './client';
import { DeviceInfoResponse, DeviceSettingsResponse, UserResponse, VipCheckResponse } from '../types/api';
import { Logger } from '../utils/log';

const dlog = new Logger('device-diag');

const logXhr = (tag: string, xhr: JQueryXHR | undefined | null): void => {
  dlog.error('{tag} status={status} text={text} resp={resp}', {
    tag,
    status: xhr && xhr.status !== undefined ? xhr.status : -1,
    text: xhr && xhr.statusText ? String(xhr.statusText) : '',
    resp: xhr && xhr.responseText ? String(xhr.responseText).substring(0, 200) : '',
  });
};

export interface UserProfile {
  readonly username: string;
  readonly avatar: string;
  readonly subscriptionDays: number;
}

const parseUserResponse = (res: UserResponse): { username: string; avatar: string; days: number } => {
  const user = res.user;
  return {
    username: user.username || '',
    avatar: (user.profile && user.profile.avatar) || '',
    days: (user.subscription && typeof user.subscription.days === 'number') ? Math.floor(user.subscription.days) : 0,
  };
};

export class DeviceApi {
  private cachedDeviceId: number | null = null;
  private cachedVip: boolean | null = null;
  private cachedProfile: UserProfile | null = null;

  readonly getCurrentDeviceInfo = (): JQueryDeferred<DeviceInfoResponse> =>
    apiClient.apiGetWithRefresh('/v1/device/info');

  readonly getDeviceId = (): JQueryDeferred<number> => {
    const d = $.Deferred<number>();
    if (this.cachedDeviceId) {
      d.resolve(this.cachedDeviceId);
      return d;
    }
    dlog.info('getDeviceId fetching /v1/device/info');
    this.getCurrentDeviceInfo().then(
      (res) => {
        if (res && res.device && res.device.id) {
          this.cachedDeviceId = res.device.id;
          dlog.info('getDeviceId ok id={id}', { id: this.cachedDeviceId });
          d.resolve(this.cachedDeviceId!);
        } else {
          dlog.error('getDeviceId bad response shape res={res}', { res: JSON.stringify(res).substring(0, 200) });
          d.reject();
        }
      },
      (xhr: JQueryXHR) => { logXhr('getDeviceInfo failed', xhr); d.reject(); }
    );
    return d;
  };

  readonly getDeviceSettings = (): JQueryDeferred<DeviceSettingsResponse> => {
    const d = $.Deferred<DeviceSettingsResponse>();
    dlog.info('getDeviceSettings start');
    this.getDeviceId().then(
      (id: number) => {
        apiClient.apiGetWithRefresh<DeviceSettingsResponse>('/v1/device/' + id + '/settings').then(
          (res) => { dlog.info('getDeviceSettings ok'); d.resolve(res); },
          (err: JQueryXHR) => { logXhr('getDeviceSettings failed', err); d.reject(err); }
        );
      },
      () => { dlog.error('getDeviceSettings: getDeviceId rejected'); d.reject(); }
    );
    return d;
  };

  readonly unlinkDevice = (): JQueryDeferred<void> =>
    apiClient.apiPostWithRefresh('/v1/device/unlink');

  readonly checkVip = (forceRefresh = false): JQueryDeferred<boolean> => {
    const d = $.Deferred<boolean>();
    if (this.cachedVip !== null && !forceRefresh) {
      d.resolve(this.cachedVip);
      return d;
    }
    dlog.info('checkVip fetching /v1/user');
    apiClient.apiGetWithRefresh<UserResponse>('/v1/user').then(
      (res) => {
        dlog.info('checkVip /v1/user ok');
        const parsed = parseUserResponse(res);
        this.cachedProfile = { username: parsed.username, avatar: parsed.avatar, subscriptionDays: parsed.days };
        if (!parsed.username) {
          dlog.warn('checkVip: empty username, resolving vip=false');
          this.cachedVip = false;
          d.resolve(false);
          return;
        }
        $.ajax({ url: '/api/vip-check', method: 'GET', data: { login: parsed.username }, dataType: 'json' }).then(
          (r: VipCheckResponse) => { this.cachedVip = !!(r && r.vip); d.resolve(this.cachedVip!); },
          (xhr: JQueryXHR) => { logXhr('vip-check failed', xhr); this.cachedVip = false; d.resolve(false); }
        );
      },
      (xhr: JQueryXHR) => { logXhr('/v1/user failed', xhr); this.cachedVip = false; d.resolve(false); }
    );
    return d;
  };

  readonly getUserProfile = (): UserProfile | null => this.cachedProfile;

  readonly saveDeviceSettings = (settings: Record<string, number | string>): JQueryDeferred<void> => {
    const d = $.Deferred<void>();
    this.getDeviceId().then(
      (id: number) => {
        apiClient.apiPost('/v1/device/' + id + '/settings', settings).then(
          () => { d.resolve(); },
          (err: JQueryXHR) => { d.reject(err); }
        );
      },
      () => { d.reject(); }
    );
    return d;
  };
}

export const deviceApi = new DeviceApi();
