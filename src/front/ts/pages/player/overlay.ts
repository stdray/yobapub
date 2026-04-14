import { Lazy } from '../../utils/lazy';

type OsdIcon = 'play' | 'pause' | 'rw' | 'ff';

interface OverlayDeps {
  readonly $root: JQuery;
  readonly info: { show(): void; hide(): void };
  readonly updateProgress: () => void;
  readonly canAutoHide: () => boolean;
}

const BAR_AUTOHIDE_MS = 4000;
const OSD_HIDE_MS = 700;
const TOAST_HIDE_MS = 1500;
const PROGRESS_TICK_MS = 1000;

const OSD_SYMBOLS: Readonly<Record<OsdIcon, string>> = {
  play: '▶', pause: '❚❚', rw: '◀◀', ff: '▶▶',
};

export class OverlayView {
  private barTimer: number | null = null;
  private osdTimer: number | null = null;
  private toastTimer: number | null = null;
  private progressTimer: number | null = null;

  private readonly $spinner: Lazy<JQuery>;
  private readonly $bar: Lazy<JQuery>;
  private readonly $osd: Lazy<JQuery>;
  private readonly $barSeek: Lazy<JQuery>;
  private readonly $toast: Lazy<JQuery>;

  constructor(private readonly deps: OverlayDeps) {
    const $root = deps.$root;
    this.$spinner = new Lazy(() => $root.find('.player__spinner'));
    this.$bar = new Lazy(() => $root.find('.player__header, .player__gradient, .player__bar'));
    this.$osd = new Lazy(() => $root.find('.player__osd'));
    this.$barSeek = new Lazy(() => $root.find('.player__bar-seek'));
    this.$toast = new Lazy(() => $root.find('.player__toast'));
  }

  // Called after tplPlayer replaces the page DOM — the previous jQuery refs
  // wrap nodes that no longer exist, so the Lazy caches must be invalidated.
  resetDomCache(): void {
    this.$spinner.reset();
    this.$bar.reset();
    this.$osd.reset();
    this.$barSeek.reset();
    this.$toast.reset();
  }

  showBar(): void {
    this.$bar.get().removeClass('hidden');
    this.deps.info.show();
    this.deps.updateProgress();
    this.startProgressTimer();
    this.clearBarTimer();
    if (this.deps.canAutoHide()) {
      this.barTimer = window.setTimeout(() => this.hideBar(), BAR_AUTOHIDE_MS);
    }
  }

  get barVisible(): boolean {
    return !this.$bar.get().first().hasClass('hidden');
  }

  hideBar(): void {
    this.stopProgressTimer();
    this.$bar.get().addClass('hidden');
    this.deps.info.hide();
  }

  showOsd(icon: OsdIcon): void {
    const $osd = this.$osd.get();
    $osd.text(OSD_SYMBOLS[icon]).removeClass('hidden');
    if (this.osdTimer !== null) clearTimeout(this.osdTimer);
    this.osdTimer = window.setTimeout(() => {
      $osd.addClass('hidden');
      this.osdTimer = null;
    }, OSD_HIDE_MS);
  }

  showToast(text: string): void {
    const $toast = this.$toast.get();
    $toast.text(text).removeClass('hidden');
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      $toast.addClass('hidden');
      this.toastTimer = null;
    }, TOAST_HIDE_MS);
  }

  clearSeekLabel = (): void => { this.$barSeek.get().text(''); };

  showSpinner = (): void => { this.$spinner.get().show(); };

  hideSpinner = (): void => { this.$spinner.get().hide(); };

  dispose(): void {
    this.clearBarTimer();
    this.stopProgressTimer();
    if (this.osdTimer !== null) { clearTimeout(this.osdTimer); this.osdTimer = null; }
    if (this.toastTimer !== null) { clearTimeout(this.toastTimer); this.toastTimer = null; }
    this.resetDomCache();
  }

  private startProgressTimer(): void {
    this.stopProgressTimer();
    this.progressTimer = window.setInterval(() => this.deps.updateProgress(), PROGRESS_TICK_MS);
  }

  private stopProgressTimer(): void {
    if (this.progressTimer !== null) { clearInterval(this.progressTimer); this.progressTimer = null; }
  }

  private clearBarTimer(): void {
    if (this.barTimer !== null) { clearTimeout(this.barTimer); this.barTimer = null; }
  }
}
