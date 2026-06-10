// Patches for the legacy hls.js 0.14 dist bundle. Two kinds:
//
// 1. Diagnostic: insert window.__ctLog() calls before every media.currentTime = X
//    assignment, so we can trace who triggers seeks on Tizen 2.3
//    (HTMLMediaElement.currentTime is a data property there — JS wrapping is impossible).
//
// 2. Fix: write the *display* width (coded * SAR) into the tkhd box. Per ISO BMFF
//    the tkhd width/height are presentation dimensions, but hls.js writes coded
//    dimensions. Chromium-based pipelines ignore tkhd (they use coded * pasp), but
//    the Tizen 2.3 platform pipeline ignores the pasp box AND CSS transforms on
//    <video> (hardware plane), so anamorphic streams render pillarboxed. tkhd is
//    the remaining lever. See decision-log 2026-06-11.
//
// Idempotent per patch: re-running is a no-op. Runs automatically before each build.

var fs = require('fs');
var path = require('path');

var HLS_PATH = path.resolve(__dirname, '..', 'node_modules', 'hls.js', 'dist', 'hls.js');

var patches = [
  {
    site: 'mp4-generator:tkhd-display-width',
    find: 'MP4.tkhd = function tkhd(track) {\n    var id = track.id,\n        duration = track.duration * track.timescale,\n        width = track.width,\n        height = track.height,',
    replace: 'MP4.tkhd = function tkhd(track) {\n    var id = track.id,\n        duration = track.duration * track.timescale,\n        width = track.pixelRatio ? Math.round(track.width * track.pixelRatio[0] / track.pixelRatio[1]) : track.width,\n        height = track.height,'
  },
  {
    // tkhd alone moved videoWidth (WebKit natural size) but not the hardware
    // video plane on Tizen 2.3 — the decoder config is built from the avc1
    // (stsd) sample entry. Pre-apply the SAR into avc1 width and neutralize
    // pasp to 1:1 so every container consumer sees the same square-pixel
    // display-size story. The SPS inside avcC keeps the real coded dims for
    // the decoder itself.
    site: 'mp4-generator:avc1-display-width',
    find: '    width = track.width,\n        height = track.height,\n        hSpacing = track.pixelRatio[0],\n        vSpacing = track.pixelRatio[1];',
    replace: '    width = track.pixelRatio ? Math.round(track.width * track.pixelRatio[0] / track.pixelRatio[1]) : track.width,\n        height = track.height,\n        hSpacing = 1,\n        vSpacing = 1;'
  },
  {
    site: 'stream-controller:_seekToStartPos',
    find: 'logger["logger"].log("seek to target start position " + startPosition + " from current time " + currentTime + ". ready state " + media.readyState);\n      media.currentTime = startPosition;',
    replace: 'logger["logger"].log("seek to target start position " + startPosition + " from current time " + currentTime + ". ready state " + media.readyState);\n      if (typeof window !== \'undefined\' && window.__ctLog) window.__ctLog(\'stream-controller:_seekToStartPos\', startPosition, currentTime);\n      media.currentTime = startPosition;'
  },
  {
    site: 'gap-controller:_trySkipBufferHole',
    find: 'this.stalled = null;\n        media.currentTime = targetTime;',
    replace: 'this.stalled = null;\n        if (typeof window !== \'undefined\' && window.__ctLog) window.__ctLog(\'gap-controller:_trySkipBufferHole\', targetTime, currentTime);\n        media.currentTime = targetTime;'
  },
  {
    site: 'gap-controller:_tryNudgeBuffer',
    find: 'logger["logger"].warn("Nudging \'currentTime\' from " + currentTime + " to " + targetTime);\n      media.currentTime = targetTime;',
    replace: 'logger["logger"].warn("Nudging \'currentTime\' from " + currentTime + " to " + targetTime);\n      if (typeof window !== \'undefined\' && window.__ctLog) window.__ctLog(\'gap-controller:_tryNudgeBuffer\', targetTime, currentTime);\n      media.currentTime = targetTime;'
  },
  {
    site: 'audio-stream-controller:altAudioAhead',
    find: 'logger["logger"].log(\'alt audio track ahead of main track, seek to start of alt audio track\');\n                  this.media.currentTime = start + 0.05;',
    replace: 'logger["logger"].log(\'alt audio track ahead of main track, seek to start of alt audio track\');\n                  if (typeof window !== \'undefined\' && window.__ctLog) window.__ctLog(\'audio-stream-controller:altAudioAhead\', start + 0.05, this.media.currentTime);\n                  this.media.currentTime = start + 0.05;'
  },
  {
    site: 'audio-stream-controller:noAltAudio',
    find: 'logger["logger"].log("no alt audio available @currentTime:" + this.media.currentTime + ", seeking @" + (nextBuffered + 0.05));\n                this.media.currentTime = nextBuffered + 0.05;',
    replace: 'logger["logger"].log("no alt audio available @currentTime:" + this.media.currentTime + ", seeking @" + (nextBuffered + 0.05));\n                if (typeof window !== \'undefined\' && window.__ctLog) window.__ctLog(\'audio-stream-controller:noAltAudio\', nextBuffered + 0.05, this.media.currentTime);\n                this.media.currentTime = nextBuffered + 0.05;'
  }
];

if (!fs.existsSync(HLS_PATH)) {
  console.error('[patch-hls] not found: ' + HLS_PATH);
  process.exit(1);
}

var src = fs.readFileSync(HLS_PATH, 'utf8');
var applied = 0;

for (var i = 0; i < patches.length; i++) {
  var p = patches[i];
  if (src.indexOf(p.replace) !== -1) {
    console.log('[patch-hls] already patched: ' + p.site);
    continue;
  }
  if (src.indexOf(p.find) === -1) {
    console.error('[patch-hls] FAILED to find anchor for ' + p.site);
    process.exit(1);
  }
  src = src.replace(p.find, p.replace);
  applied++;
  console.log('[patch-hls] patched ' + p.site);
}

if (applied > 0) fs.writeFileSync(HLS_PATH, src);
console.log('[patch-hls] done (' + applied + ' applied, ' + (patches.length - applied) + ' already present)');
