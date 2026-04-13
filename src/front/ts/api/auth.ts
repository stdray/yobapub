import $ from 'jquery';
import { apiClient } from './client';
import { TokenResponse, AuthErrorResponse } from '../types/api';
import { storage } from '../utils/storage';

export const requestDeviceCode = (): JQueryXHR =>
  $.ajax({
    url: '/oauth2/device',
    method: 'POST',
    data: {
      grant_type: 'device_code',
      client_id: apiClient.getClientId(),
      client_secret: apiClient.getClientSecret()
    },
    dataType: 'json'
  });

export const pollDeviceToken = (
  code: string,
  interval: number,
  expiresIn: number,
  onSuccess: () => void,
  onExpired: () => void,
  onError: (msg: string) => void
): { stop: () => void } => {
  let stopped = false;
  let elapsed = 0;
  let timerId: number | null = null;

  const poll = (): void => {
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
        client_id: apiClient.getClientId(),
        client_secret: apiClient.getClientSecret(),
        code: code
      },
      dataType: 'json'
    }).then(
      (data: TokenResponse) => {
        if (stopped) return;
        storage.saveTokens(data.access_token, data.refresh_token, data.expires_in);
        onSuccess();
      },
      (xhr: JQueryXHR) => {
        if (stopped) return;
        try {
          const body: AuthErrorResponse = JSON.parse(xhr.responseText);
          if (body.error === 'authorization_pending') {
            elapsed += interval;
            timerId = window.setTimeout(poll, interval * 1000);
          } else {
            onError(body.error_description || body.error);
          }
        } catch {
          onError('Network error');
          elapsed += interval;
          timerId = window.setTimeout(poll, interval * 1000);
        }
      }
    );
  };

  poll();

  return {
    stop: () => {
      stopped = true;
      if (timerId !== null) {
        clearTimeout(timerId);
      }
    }
  };
};
