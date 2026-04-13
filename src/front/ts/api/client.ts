import $ from 'jquery';
import { storage } from '../utils/storage';
import { TokenResponse } from '../types/api';

export class ApiClient {
  private clientId = '';
  private clientSecret = '';

  readonly configure = (clientId: string, clientSecret: string): void => {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  };

  readonly getClientId = (): string => this.clientId;

  readonly getClientSecret = (): string => this.clientSecret;

  private readonly refreshToken = (): JQuery.Thenable<TokenResponse> => {
    const rt = storage.getRefreshToken();
    if (!rt) {
      storage.clearTokens();
      const d = $.Deferred<TokenResponse>();
      d.reject(null, 'error', 'no_refresh_token');
      return d.promise();
    }

    return $.ajax({
      url: '/oauth2/token',
      method: 'POST',
      data: {
        grant_type: 'refresh_token',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: rt
      },
      dataType: 'json'
    });
  };

  readonly apiGet = (path: string, params?: Record<string, string | number | boolean>): JQueryXHR => {
    const token = storage.getAccessToken();
    const data: Record<string, string | number | boolean> = params ? $.extend({}, params) : {};
    if (token) {
      data['access_token'] = token;
    }
    return $.ajax({
      url: path,
      method: 'GET',
      data: data,
      dataType: 'json'
    });
  };

  readonly apiPost = (path: string, data?: Record<string, unknown>): JQueryXHR => {
    const token = storage.getAccessToken();
    let url = path;
    if (token) {
      url += '?access_token=' + encodeURIComponent(token);
    }
    return $.ajax({
      url: url,
      method: 'POST',
      data: data || {},
      dataType: 'json'
    });
  };

  readonly apiGetWithRefresh = <T = unknown>(path: string, params?: Record<string, string | number | boolean>): JQueryDeferred<T> => {
    const d = $.Deferred<T>();

    const doRequest = (): void => {
      this.apiGet(path, params).then(
        (data: T) => { d.resolve(data); },
        (xhr: JQueryXHR) => {
          if (xhr.status === 401 && storage.getRefreshToken()) {
            this.refreshToken().then(
              (tokenData: TokenResponse) => {
                storage.saveTokens(tokenData.access_token, tokenData.refresh_token, tokenData.expires_in);
                this.apiGet(path, params).then(
                  (data: T) => { d.resolve(data); },
                  (xhr2: JQueryXHR) => { d.reject(xhr2); }
                );
              },
              () => {
                storage.clearTokens();
                d.reject(xhr);
              }
            );
          } else {
            d.reject(xhr);
          }
        }
      );
    };

    doRequest();
    return d;
  };

  readonly apiPostWithRefresh = <T = unknown>(path: string, data?: Record<string, unknown>): JQueryDeferred<T> => {
    const d = $.Deferred<T>();

    const doRequest = (): void => {
      this.apiPost(path, data).then(
        (res: T) => { d.resolve(res); },
        (xhr: JQueryXHR) => {
          if (xhr.status === 401 && storage.getRefreshToken()) {
            this.refreshToken().then(
              (tokenData: TokenResponse) => {
                storage.saveTokens(tokenData.access_token, tokenData.refresh_token, tokenData.expires_in);
                this.apiPost(path, data).then(
                  (res: T) => { d.resolve(res); },
                  (xhr2: JQueryXHR) => { d.reject(xhr2); }
                );
              },
              () => {
                storage.clearTokens();
                d.reject(xhr);
              }
            );
          } else {
            d.reject(xhr);
          }
        }
      );
    };

    doRequest();
    return d;
  };
}

export const apiClient = new ApiClient();
