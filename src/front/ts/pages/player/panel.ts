import { AudioTrack, Subtitle, VideoFile } from '../../types/api';
import { Storage } from '../../utils/storage';
import { Lazy } from '../../utils/lazy';
import { tplSidePanel } from './template';

const SECTION_LABELS = ['Аудио', 'Субтитры', 'Качество', 'Размер сабов'] as const;
const SECTION_COUNT = SECTION_LABELS.length;
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
}

interface PanelCallbacks {
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

// --- Panel view ---
//
// Dumb view over the action-button row and the side-panel list. Owns only
// rendering state (current button index, list index, memory of last used
// button). All user-input / timer / focus-orchestration logic lives in the
// player FSM — this class just renders what it's told to render.
export class Panel {
  private readonly cbs: PanelCallbacks;
  private readonly $actionBtns: Lazy<JQuery>;
  private readonly $sidePanel: Lazy<JQuery>;

  private btnIndex = 0;
  private listIndex = 0;
  private listSection = 0;
  private btnsFocused = false;
  private sideOpen = false;

  // 20-sec memory: if user reopens the panel within this window we return to
  // the same button rather than starting over from section 0.
  private lastBtnIndex = 0;
  private lastCloseAt = 0;

  constructor($root: JQuery, cbs: PanelCallbacks) {
    this.cbs = cbs;
    this.$actionBtns = new Lazy(() => $root.find('.player__action-btn'));
    this.$sidePanel = new Lazy(() => $root.find('.player__side-panel'));
  }

  resetDomCache(): void {
    this.$actionBtns.reset();
    this.$sidePanel.reset();
  }

  reset(): void {
    this.btnIndex = 0;
    this.listIndex = 0;
    this.listSection = 0;
    this.btnsFocused = false;
    this.sideOpen = false;
    this.lastBtnIndex = 0;
    this.lastCloseAt = 0;
  }

  // --- queries ---

  private isSectionEnabled(section: number): boolean {
    const d = this.cbs.getData();
    if (section === 0) return d.audioEnabled;
    if (section === 1) return d.subsEnabled;
    if (section === 2) return d.qualityEnabled;
    return d.subSizeEnabled;
  }

  isCurrentBtnEnabled(): boolean {
    return this.isSectionEnabled(this.btnIndex);
  }

  private getItems(section: number): ReadonlyArray<LabeledItem> {
    const d = this.cbs.getData();
    if (section === 0) return d.audioItems;
    if (section === 1) return d.subItems;
    if (section === 2) return d.qualityItems;
    return d.subSizeItems;
  }

  // --- button row focus ---

  focusButtons(): void {
    this.btnsFocused = true;
    const within = (Date.now() - this.lastCloseAt) < RESTORE_FOCUS_MS;
    this.btnIndex = within ? this.lastBtnIndex : 0;
    if (!this.isSectionEnabled(this.btnIndex)) {
      let i = 0;
      while (i < SECTION_COUNT && !this.isSectionEnabled(i)) i++;
      this.btnIndex = i < SECTION_COUNT ? i : 0;
    }
    this.renderButtons();
  }

  unfocusButtons(): void {
    if (this.btnsFocused) {
      this.lastBtnIndex = this.btnIndex;
      this.lastCloseAt = Date.now();
    }
    this.btnsFocused = false;
    this.renderButtons();
  }

  prevBtn(): void {
    let idx = this.btnIndex - 1;
    while (idx >= 0 && !this.isSectionEnabled(idx)) idx--;
    if (idx >= 0) { this.btnIndex = idx; this.renderButtons(); }
  }

  nextBtn(): void {
    let idx = this.btnIndex + 1;
    while (idx < SECTION_COUNT && !this.isSectionEnabled(idx)) idx++;
    if (idx < SECTION_COUNT) { this.btnIndex = idx; this.renderButtons(); }
  }

  private renderButtons(): void {
    const $btns = this.$actionBtns.get();
    for (let i = 0; i < SECTION_COUNT; i++) {
      const $btn = $btns.eq(i);
      $btn.toggleClass('disabled', !this.isSectionEnabled(i));
      const on = i === this.btnIndex && this.btnsFocused && !this.sideOpen;
      if (on) $btn.addClass('focused'); else $btn.removeClass('focused');
    }
  }

  // --- side list ---

  openSideList(): void {
    this.sideOpen = true;
    this.listSection = this.btnIndex;
    const items = this.getItems(this.listSection);
    this.listIndex = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].selected) { this.listIndex = i; break; }
    }
    this.renderSideList();
    this.renderButtons();
    const $sp = this.$sidePanel.get();
    $sp.removeClass('hidden');
    setTimeout(() => { $sp.addClass('active'); }, 20);
  }

  closeSideList(): void {
    this.sideOpen = false;
    const $sp = this.$sidePanel.get();
    $sp.removeClass('active');
    setTimeout(() => { $sp.addClass('hidden'); }, 200);
    this.renderButtons();
  }

  sideListPrev(): void {
    if (this.listIndex > 0) {
      this.listIndex--;
      this.renderSideList();
    }
  }

  sideListNext(): void {
    const items = this.getItems(this.listSection);
    if (this.listIndex < items.length - 1) {
      this.listIndex++;
      this.renderSideList();
    }
  }

  applyCurrentSelection(): void {
    const items = this.getItems(this.listSection);
    const item = items[this.listIndex];
    if (!item || item.selected) return;
    if (this.listSection === 0) this.cbs.onApplyAudio(this.listIndex);
    else if (this.listSection === 1) this.cbs.onApplySub(this.listIndex);
    else if (this.listSection === 2) this.cbs.onApplyQuality(this.listIndex);
    else {
      const size = Storage.SUB_SIZE_MIN + this.listIndex * Storage.SUB_SIZE_STEP;
      this.cbs.onApplySubSize(size);
    }
    this.cbs.onSavePrefs();
  }

  private renderSideList(): void {
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
}
