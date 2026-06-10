import { Logger } from '../../utils/log';
import { HlsVideoTrack } from './hls-adapter';

// Anamorphic aspect-ratio correction.
//
// KinoPub serves some titles as anamorphic encodes: the coded frame is e.g.
// 960x704 with an H.264 SAR (sample aspect ratio) in the SPS that stretches it
// to widescreen at display time. hls.js parses the SAR and writes it into the
// fMP4 init segment as a `pasp` box. Tizen 3.0+ honors the box; the Tizen 2.3
// media pipeline ignores it and renders square pixels — pillarboxed (~4:3)
// picture instead of full width.
//
// Fix: read the SAR back from the `pasp` box of the init segment we get via
// BUFFER_CODECS, compare the aspect the platform *believes* (videoWidth /
// videoHeight) with the intended display aspect (coded * SAR), and if the
// platform rendered at the coded aspect (i.e. ignored the SAR), visually
// re-fit the <video> with a CSS scale() transform. On platforms that honor
// the SAR the factors compute to ~1 and nothing is applied.

const readU32 = (b: Uint8Array, o: number): number =>
  (((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);

const enum PaspBox {
  // 'p' 'a' 's' 'p' fourcc bytes
  P = 0x70, A = 0x61, S = 0x73,
  // full box: size(4) + fourcc(4) + hSpacing(4) + vSpacing(4)
  Size = 16,
}

interface Sar { readonly w: number; readonly h: number }

// Scan the init segment for a `pasp` box and read hSpacing/vSpacing.
// The box is tiny and unique enough that a fourcc scan with a size check
// beats a full mp4 box-tree walk.
export const parsePaspBox = (seg: Uint8Array): Sar | null => {
  for (let i = 4; i + 12 <= seg.length; i++) {
    if (seg[i] !== PaspBox.P || seg[i + 1] !== PaspBox.A || seg[i + 2] !== PaspBox.S || seg[i + 3] !== PaspBox.P) continue;
    if (readU32(seg, i - 4) !== PaspBox.Size) continue;
    const w = readU32(seg, i + 4);
    const h = readU32(seg, i + 8);
    if (w > 0 && h > 0) return { w, h };
  }
  return null;
};

interface AspectFixerDeps {
  readonly getVideoEl: () => HTMLVideoElement | null;
  readonly log: Logger;
}

interface TrackState {
  readonly width: number;
  readonly height: number;
  readonly sar: Sar;
}

// Relative tolerance when comparing aspect ratios (rounding in coded dims
// and SAR fractions makes exact equality meaningless).
const ASPECT_TOLERANCE = 0.02;

const near = (x: number, y: number): boolean => Math.abs(x - y) / y < ASPECT_TOLERANCE;

export class AspectFixer {
  private track: TrackState | null = null;
  private lastKey = '';

  constructor(private readonly deps: AspectFixerDeps) {}

  setHlsTrack(t: HlsVideoTrack): void {
    const sar = t.initSegment ? parsePaspBox(t.initSegment) : null;
    this.track = { width: t.width, height: t.height, sar: sar || { w: 1, h: 1 } };
    this.apply();
  }

  // Call on 'loadedmetadata' and 'resize' of the <video> — videoWidth becomes
  // known / changes on quality switches.
  onVideoResize(): void { this.apply(); }

  reset(): void {
    this.track = null;
    this.lastKey = '';
    const v = this.deps.getVideoEl();
    if (v) this.setTransform(v, '');
  }

  private apply(): void {
    const v = this.deps.getVideoEl();
    const t = this.track;
    if (!v || !t || !v.videoWidth || !v.videoHeight) return;

    const believed = v.videoWidth / v.videoHeight;
    const coded = t.width / t.height;
    const display = (t.width * t.sar.w) / (t.height * t.sar.h);

    const ctx = { believed, display, t };
    if (t.sar.w === t.sar.h || near(believed, display)) {
      // Square pixels, or the platform already honors the SAR.
      this.update(v, '', 'none', ctx);
      return;
    }
    if (!near(believed, coded)) {
      // Platform reports an aspect matching neither coded nor display dims —
      // don't guess, leave it alone and log for diagnosis.
      this.update(v, '', 'anomaly', ctx);
      return;
    }

    // Platform ignored the SAR and renders at the coded aspect. Re-fit the
    // contain-box of the believed aspect onto the contain-box of the intended
    // display aspect with a visual scale.
    const boxW = v.clientWidth || window.innerWidth;
    const boxH = v.clientHeight || window.innerHeight;
    if (!boxW || !boxH) return;
    const fit = (aspect: number): { w: number; h: number } =>
      boxW / boxH > aspect ? { w: boxH * aspect, h: boxH } : { w: boxW, h: boxW / aspect };
    const cur = fit(believed);
    const want = fit(display);
    const tf = 'scale(' + (want.w / cur.w).toFixed(4) + ', ' + (want.h / cur.h).toFixed(4) + ')';
    this.update(v, tf, 'stretch', ctx);
  }

  private update(
    v: HTMLVideoElement, tf: string, mode: string,
    ctx: { believed: number; display: number; t: TrackState },
  ): void {
    const key = mode + '|' + tf;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.setTransform(v, tf);
    this.deps.log.info('aspect {mode} video={vw}x{vh} coded={cw}x{ch} sar={sw}:{sh} believed={believed} display={display} transform={tf}', {
      mode,
      vw: v.videoWidth, vh: v.videoHeight,
      cw: ctx.t.width, ch: ctx.t.height,
      sw: ctx.t.sar.w, sh: ctx.t.sar.h,
      believed: ctx.believed.toFixed(4), display: ctx.display.toFixed(4),
      tf: tf || 'none',
    });
  }

  private setTransform(v: HTMLVideoElement, tf: string): void {
    // Chrome 28 (Tizen 2.3) only understands the -webkit- prefix; newer
    // platforms the unprefixed property. Set both, inline (beats stylesheet).
    v.style.setProperty('-webkit-transform', tf);
    v.style.setProperty('transform', tf);
  }
}
