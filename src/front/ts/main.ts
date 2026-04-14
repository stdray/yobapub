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
import { deviceApi } from './api/device';
import { CLIENT_ID, CLIENT_SECRET } from './config';
import { sidebar } from './sidebar';
import { Logger } from './utils/log';

const initLog = new Logger('init-diag');

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
    }
  );
};

initLog.info('main init hasToken={ht}', { ht: !!storage.getAccessToken() });
if (storage.getAccessToken()) {
  notifyDevice();
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
