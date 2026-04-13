import objectFitImages from 'object-fit-images';
import '../css/app.css';
import { Logger } from './utils/log';
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
import { deviceApi } from './api/device';
import { CLIENT_ID, CLIENT_SECRET } from './config';
import { sidebar } from './sidebar';

objectFitImages();

// DIAGNOSTIC: wrap currentTime setter on HTMLMediaElement.prototype to log every
// assignment with stack trace. Tracking who really seeks at startup on Tizen 2.3.
// Prototype-level patching because Object.defineProperty on DOM instances is unreliable
// on old WebKit/Chromium 28 — native accessors on the prototype take precedence.
// Installed at module load so it catches both playUrl (fresh mount) and playSource
// (re-use of existing video element) code paths. Remove after source is identified.
(() => {
  const diagLog = new Logger('ctwrap');
  try {
    const proto = HTMLMediaElement.prototype;
    const ctDesc = Object.getOwnPropertyDescriptor(proto, 'currentTime');
    diagLog.info('probe hasDesc={hasDesc} hasGet={hasGet} hasSet={hasSet}', {
      hasDesc: !!ctDesc,
      hasGet: !!(ctDesc && typeof ctDesc.get === 'function'),
      hasSet: !!(ctDesc && typeof ctDesc.set === 'function'),
    });
    if (!ctDesc || typeof ctDesc.set !== 'function' || typeof ctDesc.get !== 'function') return;
    const origSet = ctDesc.set;
    const origGet = ctDesc.get;
    Object.defineProperty(proto, 'currentTime', {
      configurable: true,
      get(this: HTMLMediaElement): number { return (origGet as () => number).call(this); },
      set(this: HTMLMediaElement, value: number): void {
        const prev = (origGet as () => number).call(this);
        const stack = ((new Error().stack || '').split('\n').slice(1, 10).join(' | ')).substring(0, 600);
        try {
          diagLog.info('set value={value} prev={prev} seeking={seeking} rs={rs} stack={stack}', {
            value, prev, seeking: this.seeking, rs: this.readyState, stack,
          });
        } catch (_e) { /* never break playback on log failure */ }
        (origSet as (v: number) => void).call(this, value);
      },
    });
    diagLog.info('installed on prototype');
  } catch (e) {
    diagLog.warn('install failed error={error}', { error: String(e) });
  }
})();

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

router.onAfterNavigate((route) => {
  if (sidebar.isRoute(route)) {
    sidebar.show(route);
  } else {
    sidebar.hide();
  }
});

const notifyDevice = (): void => {
  const info = platform.getDeviceInfo();
  console.log('[notify] title:', info.title, 'hw:', info.hardware, 'sw:', info.software);
  apiClient.apiPostWithRefresh('/v1/device/notify', {
    title: info.title,
    hardware: info.hardware,
    software: info.software
  }).then(
    (res: unknown) => { console.log('[notify] response:', JSON.stringify(res)); },
    (err: JQueryXHR) => { console.log('[notify] error:', err && err.status, err && err.responseText); }
  );
};

if (storage.getAccessToken()) {
  notifyDevice();
  deviceApi.checkVip().then((isVip: boolean) => {
    if (!isVip) storage.downgradeProxyForNonVip();
    sidebar.refresh();
  });
  router.navigateStartPage(storage.getStartPage());
} else {
  router.navigateLogin();
}

const closeApp = (): void => {
  console.log('[App] closeApp called, NativeApp:', typeof (window as any).NativeApp);
  if ((window as any).NativeApp) {
    (window as any).NativeApp.exit();
  } else {
    platform.exitApp();
  }
};

router.setExitHandler(() => showExitDialog(closeApp));
