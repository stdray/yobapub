import $ from 'jquery';
import { getAccessToken, getRefreshToken, saveTokens, clearTokens, isProxyEnabled } from '../utils/storage';

var API_BASE = 'https://api.service-kp.com';
var CLIENT_ID = '';
var CLIENT_SECRET = '';

export function configure(clientId: string, clientSecret: string): void {
  CLIENT_ID = clientId;
  CLIENT_SECRET = clientSecret;
}

export function getClientId(): string {
  return CLIENT_ID;
}

export function getClientSecret(): string {
  return CLIENT_SECRET;
}

export function getApiBase(): string {
  return isProxyEnabled() ? '' : API_BASE;
}

function refreshToken(): JQueryXHR {
  var rt = getRefreshToken();
  if (!rt) {
    clearTokens();
    var d = $.Deferred();
    d.reject(null, 'error', 'no_refresh_token');
    return d.promise() as any as JQueryXHR;
  }

  return $.ajax({
    url: getApiBase() + '/oauth2/token',
    method: 'POST',
    data: {
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: rt
    },
    dataType: 'json'
  });
}

export function apiGet(path: string, params?: Record<string, any>): JQueryXHR {
  var token = getAccessToken();
  var data: Record<string, any> = params ? $.extend({}, params) : {};
  if (token) {
    data['access_token'] = token;
  }
  return $.ajax({
    url: getApiBase() + path,
    method: 'GET',
    data: data,
    dataType: 'json'
  });
}

export function apiPost(path: string, data?: Record<string, any>): JQueryXHR {
  var token = getAccessToken();
  var url = getApiBase() + path;
  if (token) {
    url += '?access_token=' + encodeURIComponent(token);
  }
  return $.ajax({
    url: url,
    method: 'POST',
    data: data || {},
    dataType: 'json'
  });
}

export function apiGetWithRefresh(path: string, params?: Record<string, any>): JQueryDeferred<any> {
  var d = $.Deferred();

  function doRequest(): void {
    apiGet(path, params).then(
      function (data: any) { d.resolve(data); },
      function (xhr: JQueryXHR) {
        if (xhr.status === 401 && getRefreshToken()) {
          refreshToken().then(
            function (tokenData: any) {
              saveTokens(tokenData.access_token, tokenData.refresh_token, tokenData.expires_in);
              apiGet(path, params).then(
                function (data: any) { d.resolve(data); },
                function (xhr2: JQueryXHR) { d.reject(xhr2); }
              );
            },
            function () {
              clearTokens();
              d.reject(xhr);
            }
          );
        } else {
          d.reject(xhr);
        }
      }
    );
  }

  doRequest();
  return d;
}

export function apiPostWithRefresh(path: string, data?: Record<string, any>): JQueryDeferred<any> {
  var d = $.Deferred();

  function doRequest(): void {
    apiPost(path, data).then(
      function (res: any) { d.resolve(res); },
      function (xhr: JQueryXHR) {
        if (xhr.status === 401 && getRefreshToken()) {
          refreshToken().then(
            function (tokenData: any) {
              saveTokens(tokenData.access_token, tokenData.refresh_token, tokenData.expires_in);
              apiPost(path, data).then(
                function (res: any) { d.resolve(res); },
                function (xhr2: JQueryXHR) { d.reject(xhr2); }
              );
            },
            function () {
              clearTokens();
              d.reject(xhr);
            }
          );
        } else {
          d.reject(xhr);
        }
      }
    );
  }

  doRequest();
  return d;
}
