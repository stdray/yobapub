export function formatDuration(sec: number): string {
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  if (h > 0) return h + ' ч ' + m + ' мин';
  return m + ' мин';
}

export function formatTimecode(sec: number): string {
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = Math.floor(sec % 60);
  var pad = function (n: number) { return n < 10 ? '0' + n : '' + n; };
  if (h > 0) return h + ':' + pad(m) + ':' + pad(s);
  return pad(m) + ':' + pad(s);
}

export function formatTimeShort(sec: number): string {
  var m = Math.floor(sec / 60);
  var s = sec % 60;
  return m + ':' + (s < 10 ? '0' : '') + s;
}
