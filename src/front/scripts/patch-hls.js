// Diagnostic patch: insert window.__ctLog() calls before every media.currentTime = X
// assignment in hls.js, so we can trace who triggers seeks on Tizen 2.3
// (HTMLMediaElement.currentTime is a data property there — JS wrapping is impossible).
// Idempotent: re-running is a no-op. Runs automatically before each build.

var fs = require('fs');
var path = require('path');

var HLS_PATH = path.resolve(__dirname, '..', 'node_modules', 'hls.js', 'dist', 'hls.js');
var MARKER = '__ctLog';

var patches = [
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

if (src.indexOf(MARKER) !== -1) {
  console.log('[patch-hls] already patched, skipping');
  process.exit(0);
}

for (var i = 0; i < patches.length; i++) {
  var p = patches[i];
  if (src.indexOf(p.find) === -1) {
    console.error('[patch-hls] FAILED to find anchor for ' + p.site);
    process.exit(1);
  }
  src = src.replace(p.find, p.replace);
  console.log('[patch-hls] patched ' + p.site);
}

fs.writeFileSync(HLS_PATH, src);
console.log('[patch-hls] done (' + patches.length + ' sites)');
