// Loaded by thin platform-specific shells (Tizen widget, webOS app, etc.) from
// the external origin BEFORE they navigate to the real app. Runs in the shell's
// local document context where platform globals (tizen, webOS) are available
// and privileges apply. Registers platform-specific remote keys and then
// redirects to the app. Keeping this on the server means shell packages don't
// need to be rebuilt/reinstalled when bootstrap logic changes.
(function () {
  var APP_URL = 'http://yobapub.3po.su';

  // --- Samsung Tizen ---------------------------------------------------------
  // tizen.tvinputdevice.registerKey is an app-level input-device setting that
  // survives navigation to the external origin — see doc/decision-log.md from
  // 2026-04-14. Media/color/digit keys otherwise never reach WebKit at all.
  try {
    if (typeof tizen !== 'undefined' && tizen.tvinputdevice) {
      var tizenKeys = [
        'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop',
        'MediaFastForward', 'MediaRewind',
        'MediaTrackNext', 'MediaTrackPrevious',
        'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
      ];
      for (var i = 0; i < tizenKeys.length; i++) {
        try { tizen.tvinputdevice.registerKey(tizenKeys[i]); } catch (e) {}
      }
    }
  } catch (e) {}

  // --- LG webOS (placeholder, add when needed) -------------------------------
  // webOS media keys come through without registration, but color keys may
  // need webOSDev.LGUDID / palmInitFramework — add here when webOS support lands.

  try { localStorage.setItem('_widgetUrl', location.href); } catch (e) {}
  document.location.replace(APP_URL);
})();
