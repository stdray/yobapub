// Loaded by src/tizen-widget/src/index.html from the external origin.
// Runs inside the widget's local document context (where `tizen` is available
// and widget privileges apply), registers media/color/digit keys, then
// navigates to the app. `tizen.tvinputdevice.registerKey` is an app-level
// input-device setting that survives the navigation to the external origin —
// see doc/decision-log.md entry from 2026-04-14.
(function () {
  try {
    if (typeof tizen !== 'undefined' && tizen.tvinputdevice) {
      var keys = [
        'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop',
        'MediaFastForward', 'MediaRewind',
        'MediaTrackNext', 'MediaTrackPrevious',
        'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
      ];
      for (var i = 0; i < keys.length; i++) {
        try { tizen.tvinputdevice.registerKey(keys[i]); } catch (e) {}
      }
    }
  } catch (e) {}
  document.location.replace('http://yobapub.3po.su');
})();
