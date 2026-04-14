import { AudioTrack, Subtitle, VideoFile } from '../../types/api';
import { TvKey } from '../../utils/platform';
import { Lazy } from '../../utils/lazy';
import { tplSidePanel } from './template';

const SECTION_LABELS = ['Аудио', 'Субтитры', 'Качество'] as const;
const SECTION_COUNT = SECTION_LABELS.length;
const IDLE_MS = 4000;

interface LabeledItem {
  readonly label: string;
  readonly selected: boolean;
}

export interface PanelData {
  readonly audioItems: ReadonlyArray<LabeledItem>;
  readonly subItems: ReadonlyArray<LabeledItem>;
  readonly qualityItems: ReadonlyArray<LabeledItem>;
  readonly audioEnabled: boolean;
  readonly subsEnabled: boolean;
  readonly qualityEnabled: boolean;
}

interface PanelCallbacks {
  readonly onAfterClose: () => void;
  readonly onApplyAudio: (idx: number) => void;
  readonly onApplySub: (menuIdx: number) => void;
  readonly onApplyQuality: (idx: number) => void;
  readonly onSavePrefs: () => void;
  readonly getData: () => PanelData;
}

const buildAudioLabel = (a: AudioTrack): string => {
  let label = a.lang;
  if (a.type && a.type.title) label += ' - ' + a.type.title;
  if (a.author && a.author.title) label += ' (' + a.author.title + ')';
  label += ' [' + a.codec + ' ' + a.channels + 'ch]';
  return label;
};

export const getAudioItems = (
  audios: ReadonlyArray<AudioTrack>,
  selectedAudio: number,
  videoEl: HTMLVideoElement | null
): LabeledItem[] => {
  const items: LabeledItem[] = [];
  if (audios.length > 0) {
    for (let j = 0; j < audios.length; j++) {
      items.push({ label: buildAudioLabel(audios[j]), selected: j === selectedAudio });
    }
    return items;
  }
  if (videoEl) {
    type NativeTrack = { label: string; language: string; enabled: boolean };
    const el = videoEl as HTMLVideoElement & { audioTracks?: ArrayLike<NativeTrack> };
    const native = el.audioTracks;
    if (native && native.length > 0) {
      for (let k = 0; k < native.length; k++) {
        items.push({
          label: native[k].label || native[k].language || ('Дорожка ' + (k + 1)),
          selected: native[k].enabled,
        });
      }
      return items;
    }
  }
  items.push({ label: 'Нет данных', selected: false });
  return items;
};

export const buildSubLabel = (sub: Subtitle, idx: number): string => {
  const num = idx + 1;
  const pad = num < 10 ? '0' + num : String(num);
  let label = sub.lang.toUpperCase() + ' #' + pad;
  if (sub.forced) label += ' Forced';
  return label;
};

export const getSubItems = (
  subs: ReadonlyArray<Subtitle>,
  selectedSub: number
): LabeledItem[] => {
  const items: LabeledItem[] = [];
  if (subs.length > 0) {
    items.push({ label: 'Выкл', selected: selectedSub === -1 });
    for (let j = 0; j < subs.length; j++) {
      items.push({ label: buildSubLabel(subs[j], j), selected: j === selectedSub });
    }
    return items;
  }
  items.push({ label: 'Нет субтитров', selected: false });
  return items;
};

export const getQualityItems = (
  files: ReadonlyArray<VideoFile>,
  selectedQuality: number
): LabeledItem[] => {
  const items: LabeledItem[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    items.push({
      label: f.quality + ' (' + f.w + 'x' + f.h + ')',
      selected: i === selectedQuality,
    });
  }
  return items;
};

export class Panel {
  private readonly cbs: PanelCallbacks;
  private readonly $actionBtns: Lazy<JQuery>;
  private readonly $sidePanel: Lazy<JQuery>;

  focused = false;
  private btnIndex = 0;
  private listOpen = false;
  private listIndex = 0;
  private listSection = 0;
  private idleTimer: number | null = null;

  constructor($root: JQuery, cbs: PanelCallbacks) {
    this.cbs = cbs;
    this.$actionBtns = new Lazy(() => $root.find('.player__action-btn'));
    this.$sidePanel = new Lazy(() => $root.find('.player__side-panel'));
  }

  get open(): boolean { return this.listOpen; }

  resetDomCache(): void {
    this.$actionBtns.reset();
    this.$sidePanel.reset();
  }

  // --- queries ---

  private getItems(section: number): ReadonlyArray<LabeledItem> {
    const d = this.cbs.getData();
    if (section === 0) return d.audioItems;
    if (section === 1) return d.subItems;
    return d.qualityItems;
  }

  private isSectionEnabled(section: number): boolean {
    const d = this.cbs.getData();
    if (section === 0) return d.audioEnabled;
    if (section === 1) return d.subsEnabled;
    return d.qualityEnabled;
  }

  // --- idle timer ---

  private resetIdle(): void {
    this.clearIdle();
    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      this.unfocus();
    }, IDLE_MS);
  }

  readonly clearIdle = (): void => {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  };

  // --- render ---

  private updateButtons(): void {
    const $btns = this.$actionBtns.get();
    for (let i = 0; i < SECTION_COUNT; i++) {
      const $btn = $btns.eq(i);
      const enabled = this.isSectionEnabled(i);
      $btn.toggleClass('disabled', !enabled);
      if (i === this.btnIndex && this.focused && !this.listOpen) {
        $btn.addClass('focused');
      } else {
        $btn.removeClass('focused');
      }
    }
  }

  private renderSidePanel(): void {
    const items = this.getItems(this.listSection);
    const title = SECTION_LABELS[this.listSection];
    const $sp = this.$sidePanel.get();
    $sp.html(tplSidePanel({ title, items, focusedIndex: this.listIndex }));
    this.scrollToFocused($sp);
  }

  private scrollToFocused($container: JQuery): void {
    const el = $container.find('.player__side-item.focused')[0];
    if (!el) return;
    const container = $container[0];
    if (!container) return;
    const top = el.offsetTop;
    const bot = top + el.offsetHeight;
    if (top < container.scrollTop) {
      container.scrollTop = top;
    } else if (bot > container.scrollTop + container.clientHeight) {
      container.scrollTop = bot - container.clientHeight;
    }
  }

  // --- focus / unfocus ---

  readonly focus = (): void => {
    if (this.focused) return;
    this.focused = true;
    this.listOpen = false;
    this.btnIndex = 0;
    while (this.btnIndex < SECTION_COUNT - 1 && !this.isSectionEnabled(this.btnIndex)) {
      this.btnIndex++;
    }
    this.updateButtons();
    this.resetIdle();
  };

  private unfocus(): void {
    if (!this.focused) return;
    this.clearIdle();
    if (this.listOpen) {
      this.closeSidePanel();
    }
    this.focused = false;
    this.updateButtons();
    this.cbs.onAfterClose();
  }

  // --- side panel open / close ---

  private openSidePanel(): void {
    this.listOpen = true;
    this.listSection = this.btnIndex;
    const items = this.getItems(this.listSection);
    this.listIndex = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].selected) { this.listIndex = i; break; }
    }
    this.renderSidePanel();
    this.updateButtons();
    const $sp = this.$sidePanel.get();
    $sp.removeClass('hidden');
    setTimeout(() => { $sp.addClass('active'); }, 20);
  }

  private closeSidePanel(): void {
    this.listOpen = false;
    const $sp = this.$sidePanel.get();
    $sp.removeClass('active');
    setTimeout(() => { $sp.addClass('hidden'); }, 200);
    this.updateButtons();
  }

  private applySelection(): void {
    if (this.listSection === 0) {
      this.cbs.onApplyAudio(this.listIndex);
    } else if (this.listSection === 1) {
      this.cbs.onApplySub(this.listIndex);
    } else {
      this.cbs.onApplyQuality(this.listIndex);
    }
    this.cbs.onSavePrefs();
    this.renderSidePanel();
  }

  // --- key handling ---

  readonly handleKey = (e: JQuery.Event, kc: number): void => {
    this.resetIdle();

    if (this.listOpen) {
      this.handleListKey(e, kc);
      return;
    }

    switch (kc) {
      case TvKey.Left: {
        let idx = this.btnIndex - 1;
        while (idx >= 0 && !this.isSectionEnabled(idx)) idx--;
        if (idx >= 0) { this.btnIndex = idx; this.updateButtons(); }
        e.preventDefault(); break;
      }
      case TvKey.Right: {
        let idx = this.btnIndex + 1;
        while (idx < SECTION_COUNT && !this.isSectionEnabled(idx)) idx++;
        if (idx < SECTION_COUNT) { this.btnIndex = idx; this.updateButtons(); }
        e.preventDefault(); break;
      }
      case TvKey.Enter:
        if (this.isSectionEnabled(this.btnIndex)) this.openSidePanel();
        e.preventDefault(); break;
      case TvKey.Return: case TvKey.Backspace: case TvKey.Escape: case TvKey.Down:
        this.unfocus(); e.preventDefault(); break;
    }
  };

  private handleListKey(e: JQuery.Event, kc: number): void {
    const items = this.getItems(this.listSection);
    switch (kc) {
      case TvKey.Up:
        if (this.listIndex > 0) { this.listIndex--; this.renderSidePanel(); }
        e.preventDefault(); break;
      case TvKey.Down:
        if (this.listIndex < items.length - 1) { this.listIndex++; this.renderSidePanel(); }
        e.preventDefault(); break;
      case TvKey.Enter:
        if (items[this.listIndex] && !items[this.listIndex].selected) {
          this.applySelection();
        }
        this.closeSidePanel();
        e.preventDefault(); break;
      case TvKey.Return: case TvKey.Backspace: case TvKey.Escape: case TvKey.Left:
        this.closeSidePanel(); e.preventDefault(); break;
    }
  }

  readonly reset = (): void => {
    this.focused = false;
    this.btnIndex = 0;
    this.listOpen = false;
    this.listIndex = 0;
    this.listSection = 0;
    this.clearIdle();
  };
}
