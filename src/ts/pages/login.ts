import $ from 'jquery';
import * as doT from 'dot';
import { Page, RouteParams } from '../types/app';
import { requestDeviceCode, pollDeviceToken } from '../api/auth';
import { navigate } from '../router';
import { TvKey, getDeviceInfo } from '../utils/platform';
import { apiPost } from '../api/client';
import { pageKeys, clearPage } from '../utils/page';

var $root = $('#page-login');
var keys = pageKeys();
var poller: { stop: () => void } | null = null;
var countdownTimer: number | null = null;

var tplLoading = doT.template(
  '<div class="login">' +
    '<div class="login__title">YobaPub</div>' +
    '<div class="login__status">Загрузка...</div>' +
  '</div>'
);

var tplCode = doT.template(
  '<div class="login">' +
    '<div class="login__title">Вход в аккаунт</div>' +
    '<div class="login__url">Перейдите на <b>{{=it.uri}}</b></div>' +
    '<div class="login__code">{{=it.code}}</div>' +
    '<div class="login__timer">Код действителен: <span id="login-countdown">{{=it.expires}}</span> сек</div>' +
    '<div class="login__status">Ожидание активации...</div>' +
  '</div>'
);

var tplExpired = doT.template(
  '<div class="login">' +
    '<div class="login__title">YobaPub</div>' +
    '<div class="login__expired">Срок активации истёк!</div>' +
    '<div class="login__status">Нажмите Enter для повтора</div>' +
  '</div>'
);

var tplError = doT.template(
  '<div class="login">' +
    '<div class="login__title">YobaPub</div>' +
    '<div class="login__error">{{=it.message}}</div>' +
    '<div class="login__status">Нажмите Enter для повтора</div>' +
  '</div>'
);

function cleanup(): void {
  if (poller) {
    poller.stop();
    poller = null;
  }
  if (countdownTimer !== null) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function startAuth(): void {
  cleanup();
  $root.html(tplLoading({}));

  requestDeviceCode().then(
    function (data) {
      $root.html(tplCode({ code: data.user_code, uri: data.verification_uri, expires: data.expires_in }));

      var remaining = data.expires_in;
      countdownTimer = window.setInterval(function () {
        remaining--;
        var $el = $('#login-countdown');
        if ($el.length) { $el.text(String(remaining)); }
        if (remaining <= 0 && countdownTimer !== null) { clearInterval(countdownTimer); }
      }, 1000);

      poller = pollDeviceToken(
        data.code,
        data.interval,
        data.expires_in,
        function () {
          cleanup();
          var info = getDeviceInfo();
          apiPost('/v1/device/notify', { title: info.title, hardware: info.hardware, software: info.software });
          navigate('watching');
        },
        function () { cleanup(); $root.html(tplExpired({})); },
        function (msg) { cleanup(); $root.html(tplError({ message: msg })); }
      );
    },
    function (xhr: JQueryXHR) {
      var msg = 'Ошибка подключения к серверу';
      try {
        if (xhr && xhr.responseText) {
          var body = JSON.parse(xhr.responseText);
          msg = body.error_description || body.error || msg;
        }
        if (xhr && xhr.status) { msg += ' (' + xhr.status + ')'; }
      } catch (e) { /* ignore */ }
      $root.html(tplError({ message: msg }));
    }
  );
}

export var loginPage: Page = {
  mount: function (_params: RouteParams) {
    startAuth();
    keys.bind(function (e: JQuery.Event) {
      if (e.keyCode === TvKey.Enter) {
        if ($root.find('.login__expired, .login__error').length > 0) { startAuth(); }
      }
    });
  },
  unmount: function () {
    cleanup();
    keys.unbind();
    clearPage($root);
  }
};
