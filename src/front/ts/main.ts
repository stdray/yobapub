import objectFitImages from 'object-fit-images';
import '../css/app.css';
import { configure } from './api/client';
import { registerPage, navigate, setExitHandler } from './router';
import { registerTizenKeys, getDeviceInfo } from './utils/platform';
import { getAccessToken, getStartPage } from './utils/storage';
import { apiPostWithRefresh } from './api/client';
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
import { CLIENT_ID, CLIENT_SECRET } from './config';

objectFitImages();

configure(CLIENT_ID, CLIENT_SECRET);

registerTizenKeys();

registerPage('login', loginPage);
registerPage('watching', watchingPage);
registerPage('bookmarks', bookmarksPage);
registerPage('movie', moviePage);
registerPage('serial', serialPage);
registerPage('player', playerPage);
registerPage('settings', settingsPage);
registerPage('novelties', noveltiesPage);
registerPage('search', searchPage);
registerPage('tv', tvPage);
registerPage('tv-player', tvPlayerPage);
registerPage('history', historyPage);

function notifyDevice(): void {
  const info = getDeviceInfo();
  console.log('[notify] title:', info.title, 'hw:', info.hardware, 'sw:', info.software);
  apiPostWithRefresh('/v1/device/notify', {
    title: info.title,
    hardware: info.hardware,
    software: info.software
  }).then(
    function (res: any) { console.log('[notify] response:', JSON.stringify(res)); },
    function (err: any) { console.log('[notify] error:', err && err.status, err && err.responseText); }
  );
}

if (getAccessToken()) {
  notifyDevice();
  navigate(getStartPage());
} else {
  navigate('login');
}

if ((window as any).NativeApp) {
  setExitHandler(function() {
    (window as any).NativeApp.exit();
  });
}
