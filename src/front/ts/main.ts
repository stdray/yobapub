import objectFitImages from 'object-fit-images';
import '../css/app.css';
import { apiClient } from './api/client';
import { router } from './router';
import { platform } from './utils/platform';
import { showExitDialog } from './utils/exit-dialog';
import { storage } from './utils/storage';
import { loginPage } from './pages/login';
import { watchingPage } from './pages/watching';
import { bookmarksPage } from './pages/bookmarks';
import { moviePage } from './pages/movie';
import { serialPage } from './pages/serial';
import { playerPage } from './pages/player';
import { settingsPage } from './pages/settings';
import { noveltiesPage } from './pages/novelties';
import { searchPage } from './pages/search';
import { tvPage } from './pages/tv';
import { tvPlayerPage } from './pages/tv-player';
import { historyPage } from './pages/history';
import { testPlayerPage } from './pages/test-player';
import { deviceApi } from './api/device';
import { CLIENT_ID, CLIENT_SECRET } from './config';
import { sidebar } from './sidebar';
import { Logger } from './utils/log';

const initLog = new Logger('init-diag');
const crashLog = new Logger('crash');
const envLog = new Logger('env');

(() => {
  let tizenVer = 'n/a';
  try {
    if (typeof tizen !== 'undefined' && tizen.systeminfo) {
      const cap = tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version');
      if (cap) tizenVer = String(cap);
    }
  } catch (_e) { /* ignore */ }
  const mse = (window as unknown as { MediaSource?: { isTypeSupported: (t: string) => boolean } }).MediaSource;
  const canType = (t: string): boolean => {
    try { return !!(mse && mse.isTypeSupported(t)); } catch (_e) { return false; }
  };
  envLog.info('[env] ua={ua}', { ua: navigator.userAgent });
  envLog.info('[env] tizen={v}', { v: tizenVer });
  envLog.info('[env] mse hvc1={hvc1} hev1={hev1} avc1={avc1}', {
    hvc1: canType('video/mp4; codecs="hvc1.1.6.L150.B0"'),
    hev1: canType('video/mp4; codecs="hev1.1.6.L150.B0"'),
    avc1: canType('video/mp4; codecs="avc1.640028"'),
  });
})();

window.onerror = (message, source, lineno, colno, error): void => {
  crashLog.error('window.onerror {msg} at {src}:{line}:{col} stack={stack}', {
    msg: String(message),
    src: String(source || ''),
    line: lineno || 0,
    col: colno || 0,
    stack: error && error.stack ? error.stack.substring(0, 800) : '',
  });
};

window.onunhandledrejection = (ev): void => {
  const reason = ev.reason as { message?: string; stack?: string } | undefined;
  crashLog.error('unhandledrejection {msg} stack={stack}', {
    msg: reason && reason.message ? reason.message : String(ev.reason),
    stack: reason && reason.stack ? reason.stack.substring(0, 800) : '',
  });
};

objectFitImages();

apiClient.configure(CLIENT_ID, CLIENT_SECRET);

platform.registerTizenKeys();

router.registerPage('login', loginPage);
router.registerPage('watching', watchingPage);
router.registerPage('bookmarks', bookmarksPage);
router.registerPage('movie', moviePage);
router.registerPage('serial', serialPage);
router.registerPage('player', playerPage);
router.registerPage('settings', settingsPage);
router.registerPage('novelties', noveltiesPage);
router.registerPage('search', searchPage);
router.registerPage('tv', tvPage);
router.registerPage('tv-player', tvPlayerPage);
router.registerPage('history', historyPage);
router.registerPage('test-player', testPlayerPage);

router.onAfterNavigate((route) => {
  if (sidebar.isRoute(route)) {
    sidebar.show(route);
  } else {
    sidebar.hide();
  }
});

const notifyDevice = (): void => {
  const info = platform.getDeviceInfo();
  initLog.info('notify start title={title} hw={hw} sw={sw}', { title: info.title, hw: info.hardware, sw: info.software });
  apiClient.apiPostWithRefresh('/v1/device/notify', {
    title: info.title,
    hardware: info.hardware,
    software: info.software
  }).then(
    (res: unknown) => { initLog.info('notify ok resp={resp}', { resp: JSON.stringify(res).substring(0, 200) }); },
    (err: JQueryXHR) => {
      initLog.error('notify failed status={status} text={text} resp={resp}', {
        status: err ? err.status : -1,
        text: err ? String(err.statusText || '') : '',
        resp: err ? String(err.responseText || '').substring(0, 200) : '',
      });
      if (err && (err.status === 401 || err.status === 403)) {
        storage.clearTokens();
        router.navigateLogin();
      }
    }
  );
};

const primeDeviceSettings = (): void => {
  deviceApi.getDeviceSettings().then(
    (res) => {
      if (res && res.settings) {
        storage.setDeviceSettingsFromApi(res.settings);
        initLog.info('primeDeviceSettings cached keys={keys}', {
          keys: Object.keys(res.settings).join(','),
        });
      }
    },
    () => { /* errors already logged inside deviceApi */ }
  );
};

initLog.info('main init hasToken={ht}', { ht: !!storage.getAccessToken() });
if (storage.getAccessToken()) {
  notifyDevice();
  primeDeviceSettings();
  deviceApi.checkVip().then((isVip: boolean) => {
    initLog.info('initial checkVip resolved vip={vip}', { vip: isVip });
    if (!isVip) storage.downgradeProxyForNonVip();
    sidebar.refresh();
  });
  router.navigateStartPage(storage.getStartPage());
} else {
  router.navigateLogin();
}

const closeApp = (): void => {
  console.log('[App] closeApp called, NativeApp:', typeof window.NativeApp);
  if (window.NativeApp) {
    window.NativeApp.exit();
  } else {
    platform.exitApp();
  }
};

router.setExitHandler(() => showExitDialog(closeApp));
