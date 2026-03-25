import '../css/app.css';
import { configure } from './api/client';
import { registerPage, navigate } from './router';
import { registerTizenKeys, getDeviceInfo } from './utils/platform';
import { getAccessToken } from './utils/storage';
import { apiPostWithRefresh } from './api/client';
import { loginPage } from './pages/login';
import { watchingPage } from './pages/watching';
import { moviePage } from './pages/movie';
import { serialPage } from './pages/serial';
import { playerPage } from './pages/player';
import { settingsPage } from './pages/settings';
import { CLIENT_ID, CLIENT_SECRET } from './config';

configure(CLIENT_ID, CLIENT_SECRET);

registerTizenKeys();

registerPage('login', loginPage);
registerPage('watching', watchingPage);
registerPage('movie', moviePage);
registerPage('serial', serialPage);
registerPage('player', playerPage);
registerPage('settings', settingsPage);

function notifyDevice(): void {
  var info = getDeviceInfo();
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
  navigate('watching');
} else {
  navigate('login');
}
