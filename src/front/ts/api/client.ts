import $ from 'jquery';
import { storage } from '../utils/storage';

export class ApiClient {
  private clientId = '';
  private clientSecret = '';

  readonly configure = (clientId: string, clientSecret: string): void => {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  };

  readonly getClientId = (): string => this.clientId;

  readonly getClientSecret = (): string => this.clientSecret;

  private readonly refreshToken = (): JQueryXHR => {
    const rt = storage.getRefreshToken();
    if (!rt) {
      storage.clearTokens();
      const d = $.Deferred();
      d.reject(null, 'error', 'no_refresh_token');
      return d.promise() as any as JQueryXHR;
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

  readonly apiGet = (path: string, params?: Record<string, any>): JQueryXHR => {
    const token = storage.getAccessToken();
    const data: Record<string, any> = params ? $.extend({}, params) : {};
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

  readonly apiPost = (path: string, data?: Record<string, any>): JQueryXHR => {
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

  readonly apiGetWithRefresh = (path: string, params?: Record<string, any>): JQueryDeferred<any> => {
    const d = $.Deferred();

    const doRequest = (): void => {
      this.apiGet(path, params).then(
        (data: any) => { d.resolve(data); },
        (xhr: JQueryXHR) => {
          if (xhr.status === 401 && storage.getRefreshToken()) {
            this.refreshToken().then(
              (tokenData: any) => {
                storage.saveTokens(tokenData.access_token, tokenData.refresh_token, tokenData.expires_in);
                this.apiGet(path, params).then(
                  (data: any) => { d.resolve(data); },
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

  readonly apiPostWithRefresh = (path: string, data?: Record<string, any>): JQueryDeferred<any> => {
    const d = $.Deferred();

    const doRequest = (): void => {
      this.apiPost(path, data).then(
        (res: any) => { d.resolve(res); },
        (xhr: JQueryXHR) => {
          if (xhr.status === 401 && storage.getRefreshToken()) {
            this.refreshToken().then(
              (tokenData: any) => {
                storage.saveTokens(tokenData.access_token, tokenData.refresh_token, tokenData.expires_in);
                this.apiPost(path, data).then(
                  (res: any) => { d.resolve(res); },
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
