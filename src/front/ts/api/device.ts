import $ from 'jquery';
import { apiClient } from './client';
import { DeviceInfoResponse, DeviceSettingsResponse, VipCheckResponse } from '../types/api';

export interface UserProfile {
  readonly username: string;
  readonly avatar: string;
  readonly subscriptionDays: number;
}

const parseUserData = (res: unknown): { readonly username: string; readonly avatar: string; readonly days: number } => {
  const data = Array.isArray(res) ? res[0] : res as Record<string, unknown>;
  const user = (data && (data as Record<string, unknown>).user) as Record<string, unknown> | undefined;
  const username = user && user.username ? String(user.username) : '';
  const profile = user && user.profile as Record<string, unknown> | undefined;
  const avatar = profile && profile.avatar ? String(profile.avatar) : '';
  const sub = user && user.subscription as Record<string, unknown> | undefined;
  const days = sub && typeof sub.days === 'number' ? Math.floor(sub.days) : 0;
  return { username, avatar, days };
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
    this.getCurrentDeviceInfo().then(
      (res) => {
        if (res && res.device && res.device.id) {
          this.cachedDeviceId = res.device.id;
          d.resolve(this.cachedDeviceId!);
        } else {
          d.reject();
        }
      },
      () => { d.reject(); }
    );
    return d;
  };

  readonly getDeviceSettings = (): JQueryDeferred<DeviceSettingsResponse> => {
    const d = $.Deferred<DeviceSettingsResponse>();
    this.getDeviceId().then(
      (id: number) => {
        apiClient.apiGetWithRefresh<DeviceSettingsResponse>('/v1/device/' + id + '/settings').then(
          (res) => { d.resolve(res); },
          (err) => { d.reject(err); }
        );
      },
      () => { d.reject(); }
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
    apiClient.apiGetWithRefresh('/v1/user').then(
      (res: unknown) => {
        const parsed = parseUserData(res);
        this.cachedProfile = { username: parsed.username, avatar: parsed.avatar, subscriptionDays: parsed.days };
        if (!parsed.username) {
          this.cachedVip = false;
          d.resolve(false);
          return;
        }
        $.ajax({ url: '/api/vip-check', method: 'GET', data: { login: parsed.username }, dataType: 'json' }).then(
          (r: VipCheckResponse) => { this.cachedVip = !!(r && r.vip); d.resolve(this.cachedVip!); },
          () => { this.cachedVip = false; d.resolve(false); }
        );
      },
      () => { this.cachedVip = false; d.resolve(false); }
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
