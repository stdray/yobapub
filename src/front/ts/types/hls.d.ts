// Augment @types/hls.js@0.13 with the `Hls.version` static, which exists in
// both 0.14.x and 1.5+ runtime but is missing from the typings.
import 'hls.js';

declare module 'hls.js' {
  namespace Hls {
    const version: string;
  }
}
