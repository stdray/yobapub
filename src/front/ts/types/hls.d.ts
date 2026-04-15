// Augment the globally-declared Hls class from @types/hls.js with APIs that
// exist in 0.14.x and 1.5+ runtime but are missing from the upstream typings.
// @types/hls.js uses the old UMD pattern (`declare class Hls` at the top level
// + `export = Hls`), so we merge via a class + interface declaration merge at
// the same global scope. This file must stay ambient (no top-level import/export).

interface Hls {
  trigger(event: 'hlsBufferFlushing', data: Hls.bufferFlushingData): void;
}
