export enum TvKey {
  Left = 37,
  Up = 38,
  Right = 39,
  Down = 40,
  Enter = 13,
  Return = 10009,
  Backspace = 8,
  Escape = 27,
  Play = 415,
  Pause = 19,
  PlayPause = 10252,
  Stop = 413,
  Ff = 417,
  Rw = 412,
  TrackPrev = 10232,
  TrackNext = 10233,
  Red = 403,
  Green = 404,
  Yellow = 405,
  Blue = 406,
  Key0 = 48,
  Key1 = 49,
  Key2 = 50,
  Key3 = 51,
  Key4 = 52,
  Key5 = 53,
  Key6 = 54,
  Key7 = 55,
  Key8 = 56,
  Key9 = 57
}

declare var tizen: any;
declare var webapis: any;

export function registerTizenKeys(): void {
  try {
    if (typeof tizen !== 'undefined' && tizen.tvinputdevice) {
      var keysToRegister = [
        'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop',
        'MediaFastForward', 'MediaRewind',
        'MediaTrackNext', 'MediaTrackPrevious',
        'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
      ];
      for (var i = 0; i < keysToRegister.length; i++) {
        try {
          tizen.tvinputdevice.registerKey(keysToRegister[i]);
        } catch (e) {
          // key may not be supported on this device
        }
      }
    }
  } catch (e) {
    console.log('[Platform] Not running on Tizen');
  }
}

export interface DeviceInfo {
  title: string;
  hardware: string;
  software: string;
}

export function getDeviceInfo(): DeviceInfo {
  var title = 'YobaPub Tizen';
  var hardware = 'Unknown';
  var software = 'Unknown';

  try {
    if (typeof webapis !== 'undefined' && webapis.productinfo) {
      var model = webapis.productinfo.getModel ? webapis.productinfo.getModel() : '';
      var firmware = webapis.productinfo.getFirmware ? webapis.productinfo.getFirmware() : '';
      hardware = 'Samsung ' + (model || 'Smart TV');
      software = 'Tizen' + (firmware ? ' ' + firmware : '');
      title = 'YobaPub ' + hardware;
    }
  } catch (e) {
    // not on Tizen
  }

  // Fallback for browser testing
  if (hardware === 'Unknown') {
    var ua = navigator.userAgent;
    if (ua.indexOf('Tizen') !== -1) {
      hardware = 'Samsung Smart TV';
      var tizenMatch = ua.match(/Tizen\s*([\d.]+)/);
      software = 'Tizen' + (tizenMatch ? ' ' + tizenMatch[1] : '');
      title = 'YobaPub Samsung TV';
    } else {
      var browserMatch = ua.match(/(Chrome|Firefox|Safari|Edge)\/([\d.]+)/);
      var osMatch = ua.match(/(Windows|Mac OS X|Linux|Android|iOS)[^\s;)]*/);
      hardware = osMatch ? osMatch[0] : 'Browser';
      software = browserMatch ? browserMatch[1] + ' ' + browserMatch[2] : navigator.userAgent.substring(0, 50);
      title = 'YobaPub Web';
    }
  }

  return { title: title, hardware: hardware, software: software };
}

export function getTizenVersion(): number {
  try {
    if (typeof tizen !== 'undefined' && tizen.systeminfo) {
      var cap = tizen.systeminfo.getCapability('http://tizen.org/feature/platform.version');
      if (cap) return parseFloat(cap) || 0;
    }
  } catch (e) { /* ignore */ }
  var m = navigator.userAgent.match(/Tizen\s*([\d.]+)/);
  return m ? (parseFloat(m[1]) || 0) : 0;
}

export function isLegacyTizen(): boolean {
  var v = getTizenVersion();
  return v > 0 && v < 3;
}

export function isAndroidWebView(): boolean {
  return typeof (window as any).NativeApp !== 'undefined' || /Android.*wv\b/.test(navigator.userAgent);
}

export function exitApp(): void {
  try {
    if (typeof tizen !== 'undefined' && tizen.application) {
      tizen.application.getCurrentApplication().exit();
    }
  } catch (e) {
    console.log('[Platform] Cannot exit app');
  }
}
