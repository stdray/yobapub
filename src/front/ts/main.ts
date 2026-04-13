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
