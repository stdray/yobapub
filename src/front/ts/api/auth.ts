import $ from 'jquery';
import { getClientId, getClientSecret } from './client';
import { DeviceCodeResponse, TokenResponse, AuthErrorResponse } from '../types/api';
import { storage } from '../utils/storage';

export function requestDeviceCode(): JQueryXHR {
  return $.ajax({
    url: '/oauth2/device',
    method: 'POST',
    data: {
      grant_type: 'device_code',
      client_id: getClientId(),
      client_secret: getClientSecret()
    },
    dataType: 'json'
  });
}

export function pollDeviceToken(
  code: string,
  interval: number,
  expiresIn: number,
  onSuccess: () => void,
  onExpired: () => void,
  onError: (msg: string) => void
): { stop: () => void } {
  let stopped = false;
  let elapsed = 0;
  let timerId: number | null = null;

  function poll(): void {
    if (stopped) return;
    if (elapsed >= expiresIn) {
      onExpired();
      return;
    }

    $.ajax({
      url: '/oauth2/device',
      method: 'POST',
      data: {
        grant_type: 'device_token',
        client_id: getClientId(),
        client_secret: getClientSecret(),
        code: code
      },
      dataType: 'json'
    }).then(
      function (data: TokenResponse) {
        if (stopped) return;
        storage.saveTokens(data.access_token, data.refresh_token, data.expires_in);
        onSuccess();
      },
      function (xhr: JQueryXHR) {
        if (stopped) return;
        try {
          const body: AuthErrorResponse = JSON.parse(xhr.responseText);
          if (body.error === 'authorization_pending') {
            elapsed += interval;
            timerId = window.setTimeout(poll, interval * 1000);
          } else {
            onError(body.error_description || body.error);
          }
        } catch (e) {
          onError('Network error');
          elapsed += interval;
          timerId = window.setTimeout(poll, interval * 1000);
        }
      }
    );
  }

  poll();

  return {
    stop: function () {
      stopped = true;
      if (timerId !== null) {
        clearTimeout(timerId);
      }
    }
  };
}
