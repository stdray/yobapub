import { AudioTrack, Subtitle, VideoFile } from '../../types/api';
import { TvKey } from '../../utils/platform';
import { Storage } from '../../utils/storage';
import { Lazy } from '../../utils/lazy';
import { Logger } from '../../utils/log';
import { tplSidePanel } from './template';

const log = new Logger('panel');

const SECTION_LABELS = ['Аудио', 'Субтитры', 'Качество', 'Размер сабов'] as const;
const SECTION_COUNT = SECTION_LABELS.length;
const BTN_COUNT = SECTION_COUNT + 1; // index 0 = play/pause, 1..4 = sections
const BTN_PLAY = 0;
const IDLE_MS = 6000;
const RESTORE_FOCUS_MS = 20000;

interface LabeledItem {
  readonly label: string;
  readonly selected: boolean;
}

export interface PanelData {
  readonly audioItems: ReadonlyArray<LabeledItem>;
  readonly subItems: ReadonlyArray<LabeledItem>;
  readonly qualityItems: ReadonlyArray<LabeledItem>;
  readonly subSizeItems: ReadonlyArray<LabeledItem>;
  readonly audioEnabled: boolean;
  readonly subsEnabled: boolean;
  readonly qualityEnabled: boolean;
  readonly subSizeEnabled: boolean;
  readonly isPaused: boolean;
}

interface PanelCallbacks {
  readonly onAfterClose: () => void;
  readonly onTogglePlay: () => void;
  readonly onApplyAudio: (idx: number) => void;
  readonly onApplySub: (menuIdx: number) => void;
  readonly onApplyQuality: (idx: number) => void;
  readonly onApplySubSize: (size: number) => void;
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

export const getSubSizeItems = (currentSize: number): LabeledItem[] => {
  const items: LabeledItem[] = [];
  for (let s = Storage.SUB_SIZE_MIN; s <= Storage.SUB_SIZE_MAX; s += Storage.SUB_SIZE_STEP) {
    items.push({ label: s + 'px', selected: s === currentSize });
  }
  return items;
};

export class Panel {
  private readonly cbs: PanelCallbacks;
  private readonly $actionBtns: Lazy<JQuery>;
  private readonly $sidePanel: Lazy<JQuery>;

  focused = false;
  private btnIndex = BTN_PLAY;
  private listOpen = false;
  private listIndex = 0;
  private listSection = 0;
  private idleTimer: number | null = null;
  private lastBtnIndex = BTN_PLAY;
  private lastCloseAt = 0;

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
    if (section === 2) return d.qualityItems;
    return d.subSizeItems;
  }

  private isSectionEnabled(section: number): boolean {
    const d = this.cbs.getData();
    if (section === 0) return d.audioEnabled;
    if (section === 1) return d.subsEnabled;
    if (section === 2) return d.qualityEnabled;
    return d.subSizeEnabled;
  }

  private isButtonEnabled(btn: number): boolean {
    if (btn === BTN_PLAY) return true;
    return this.isSectionEnabled(btn - 1);
  }

  // --- idle timer ---

  private resetIdle(): void {
    this.clearIdle();
    this.idleTimer = window.setTimeout(() => {
      log.info('idle fired → unfocus (focused={f} listOpen={o})', { f: this.focused, o: this.listOpen });
      this.idleTimer = null;
      this.unfocus();
    }, IDLE_MS);
    log.info('idle reset ({ms}ms) focused={f} listOpen={o}', { ms: IDLE_MS, f: this.focused, o: this.listOpen });
  }

  readonly clearIdle = (): void => {
    if (this.idleTimer !== null) {
      log.info('idle cleared');
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  };

  // --- render ---

  private updateButtons(): void {
    const $btns = this.$actionBtns.get();
    const d = this.cbs.getData();
    for (let i = 0; i < BTN_COUNT; i++) {
      const $btn = $btns.eq(i);
      if (i === BTN_PLAY) {
        $btn.text(d.isPaused ? '▶' : '❚❚');
      }
      const enabled = this.isButtonEnabled(i);
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
    log.info('focus() called focused={f} sinceClose={dt}', { f: this.focused, dt: Date.now() - this.lastCloseAt });
    if (this.focused) return;
    this.focused = true;
    this.listOpen = false;
    const within = (Date.now() - this.lastCloseAt) < RESTORE_FOCUS_MS;
    this.btnIndex = within ? this.lastBtnIndex : BTN_PLAY;
    if (!this.isButtonEnabled(this.btnIndex)) {
      this.btnIndex = BTN_PLAY;
      let i = this.btnIndex;
      while (i < BTN_COUNT && !this.isButtonEnabled(i)) i++;
      if (i < BTN_COUNT) this.btnIndex = i;
    }
    this.updateButtons();
    this.resetIdle();
  };

  private unfocus(): void {
    log.info('unfocus() called focused={f} listOpen={o}', { f: this.focused, o: this.listOpen });
    if (!this.focused) return;
    this.clearIdle();
    if (this.listOpen) {
      this.closeSidePanel();
    }
    this.lastBtnIndex = this.btnIndex;
    this.lastCloseAt = Date.now();
    this.focused = false;
    this.updateButtons();
    this.cbs.onAfterClose();
  }

  // --- side panel open / close ---

  private openSidePanel(): void {
    log.info('openSidePanel btnIdx={s}', { s: this.btnIndex });
    this.resetIdle();
    this.listOpen = true;
    this.listSection = this.btnIndex - 1;
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
    log.info('closeSidePanel focused={f}', { f: this.focused });
    this.resetIdle();
    this.listOpen = false;
    const $sp = this.$sidePanel.get();
    $sp.removeClass('active');
    setTimeout(() => { $sp.addClass('hidden'); }, 200);
    this.updateButtons();
  }

  private applySelection(): void {
    log.info('applySelection section={s} idx={i}', { s: this.listSection, i: this.listIndex });
    this.resetIdle();
    if (this.listSection === 0) {
      this.cbs.onApplyAudio(this.listIndex);
    } else if (this.listSection === 1) {
      this.cbs.onApplySub(this.listIndex);
    } else if (this.listSection === 2) {
      this.cbs.onApplyQuality(this.listIndex);
    } else {
      const size = Storage.SUB_SIZE_MIN + this.listIndex * Storage.SUB_SIZE_STEP;
      this.cbs.onApplySubSize(size);
    }
    this.cbs.onSavePrefs();
    this.renderSidePanel();
  }

  // --- key handling ---

  readonly handleKey = (e: JQuery.Event, kc: number): void => {
    log.info('handleKey kc={kc} focused={f} listOpen={o} btnIdx={b} listIdx={li}', {
      kc, f: this.focused, o: this.listOpen, b: this.btnIndex, li: this.listIndex,
    });
    this.resetIdle();

    if (this.listOpen) {
      this.handleListKey(e, kc);
      return;
    }

    switch (kc) {
      case TvKey.Left: {
        let idx = this.btnIndex - 1;
        while (idx >= 0 && !this.isButtonEnabled(idx)) idx--;
        if (idx >= 0) { this.btnIndex = idx; this.updateButtons(); }
        e.preventDefault(); break;
      }
      case TvKey.Right: {
        let idx = this.btnIndex + 1;
        while (idx < BTN_COUNT && !this.isButtonEnabled(idx)) idx++;
        if (idx < BTN_COUNT) { this.btnIndex = idx; this.updateButtons(); }
        e.preventDefault(); break;
      }
      case TvKey.Enter:
        if (this.btnIndex === BTN_PLAY) {
          this.cbs.onTogglePlay();
          this.updateButtons();
        } else if (this.isButtonEnabled(this.btnIndex)) {
          this.openSidePanel();
        }
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
    this.btnIndex = BTN_PLAY;
    this.listOpen = false;
    this.listIndex = 0;
    this.listSection = 0;
    this.lastBtnIndex = BTN_PLAY;
    this.lastCloseAt = 0;
    this.clearIdle();
  };
}
