import { AudioTrack, Subtitle, VideoFile } from '../../types/api';
import { Storage } from '../../utils/storage';
import { Lazy } from '../../utils/lazy';
import { tplSidePanel } from './template';

export const enum Section {
  PrevEp = 0,
  NextEp = 1,
  Audio = 2,
  Subs = 3,
  Quality = 4,
  SubSize = 5,
  MarkWatched = 6,
}

interface PanelButtonDef {
  readonly section: Section;
  readonly label: string;
  readonly instant: boolean;
}

// Single source of truth for the action-button row. UI order = array order.
// `Section` is what identifies the button in logic; `label` and `instant` feed
// the template at render time.
export const PANEL_BUTTONS: ReadonlyArray<PanelButtonDef> = [
  { section: Section.PrevEp,  label: 'Пред. серия',   instant: true  },
  { section: Section.NextEp,  label: 'След. серия',   instant: true  },
  { section: Section.Audio,   label: 'Аудио',         instant: false },
  { section: Section.Subs,    label: 'Субтитры',      instant: false },
  { section: Section.Quality, label: 'Качество',      instant: false },
  { section: Section.SubSize,     label: 'Размер сабов',  instant: false },
  { section: Section.MarkWatched, label: '✔',     instant: true  },
];

const SECTION_COUNT = PANEL_BUTTONS.length;

const findBtn = (section: Section): PanelButtonDef => {
  for (let i = 0; i < PANEL_BUTTONS.length; i++) {
    if (PANEL_BUTTONS[i].section === section) return PANEL_BUTTONS[i];
  }
  throw new Error('unknown section: ' + section);
};

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
  readonly prevEpisodeEnabled: boolean;
  readonly nextEpisodeEnabled: boolean;
  readonly watched: boolean;
}

interface PanelCallbacks {
  readonly onApplyAudio: (idx: number) => void;
  readonly onApplySub: (menuIdx: number) => void;
  readonly onApplyQuality: (idx: number) => void;
  readonly onApplySubSize: (size: number) => void;
  readonly onPrevEpisode: () => void;
  readonly onNextEpisode: () => void;
  readonly onMarkWatched: () => void;
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
    const codec = f.codec ? ' ' + f.codec.toUpperCase() : '';
    items.push({
      label: f.quality + ' (' + f.w + 'x' + f.h + ')' + codec,
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

  private btnPos = 0;
  private listIndex = 0;
  private listSection: Section = Section.PrevEp;
  private btnsFocused = false;
  private sideOpen = false;

  // 20-sec memory: if user reopens the panel within this window we return to
  // the same button rather than starting over from the first section.
  private lastBtnPos = 0;
  private lastCloseAt = 0;
  private lastMode: 'seek' | 'buttons' = 'seek';

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
    this.btnPos = 0;
    this.listIndex = 0;
    this.listSection = Section.PrevEp;
    this.btnsFocused = false;
    this.sideOpen = false;
    this.lastBtnPos = 0;
    this.lastCloseAt = 0;
    this.lastMode = 'seek';
  }

  markSeekClosed(): void {
    this.lastMode = 'seek';
    this.lastCloseAt = Date.now();
  }

  markButtonsClosed(): void {
    this.lastMode = 'buttons';
    this.lastBtnPos = this.btnPos;
    this.lastCloseAt = Date.now();
  }

  wasLastModeButtons(): boolean {
    return this.lastMode === 'buttons'
      && (Date.now() - this.lastCloseAt) < RESTORE_FOCUS_MS;
  }

  // --- queries ---

  private currentSection(): Section {
    return PANEL_BUTTONS[this.btnPos].section;
  }

  private isSectionEnabled(section: Section): boolean {
    const d = this.cbs.getData();
    switch (section) {
      case Section.PrevEp:  return d.prevEpisodeEnabled;
      case Section.NextEp:  return d.nextEpisodeEnabled;
      case Section.Audio:   return d.audioEnabled;
      case Section.Subs:    return d.subsEnabled;
      case Section.Quality:     return d.qualityEnabled;
      case Section.SubSize:     return d.subSizeEnabled;
      case Section.MarkWatched: return !d.watched;
    }
  }

  isCurrentBtnEnabled(): boolean {
    return this.isSectionEnabled(this.currentSection());
  }

  isCurrentBtnInstant(): boolean {
    return PANEL_BUTTONS[this.btnPos].instant;
  }

  applyInstantButton(): void {
    const s = this.currentSection();
    if (s === Section.PrevEp) this.cbs.onPrevEpisode();
    else if (s === Section.NextEp) this.cbs.onNextEpisode();
    else if (s === Section.MarkWatched) this.cbs.onMarkWatched();
  }

  private getItems(section: Section): ReadonlyArray<LabeledItem> {
    const d = this.cbs.getData();
    switch (section) {
      case Section.Audio:   return d.audioItems;
      case Section.Subs:    return d.subItems;
      case Section.Quality: return d.qualityItems;
      default:              return d.subSizeItems;
    }
  }

  // --- button row focus ---

  focusButtons(): void {
    this.btnsFocused = true;
    const within = (Date.now() - this.lastCloseAt) < RESTORE_FOCUS_MS;
    this.btnPos = within ? this.lastBtnPos : 0;
    if (!this.isSectionEnabled(this.currentSection())) {
      let i = 0;
      while (i < SECTION_COUNT && !this.isSectionEnabled(PANEL_BUTTONS[i].section)) i++;
      this.btnPos = i < SECTION_COUNT ? i : 0;
    }
    this.renderButtons();
  }

  unfocusButtons(): void {
    this.btnsFocused = false;
    this.renderButtons();
  }

  prevBtn(): void {
    let pos = this.btnPos - 1;
    while (pos >= 0 && !this.isSectionEnabled(PANEL_BUTTONS[pos].section)) pos--;
    if (pos >= 0) { this.btnPos = pos; this.renderButtons(); }
  }

  nextBtn(): void {
    let pos = this.btnPos + 1;
    while (pos < SECTION_COUNT && !this.isSectionEnabled(PANEL_BUTTONS[pos].section)) pos++;
    if (pos < SECTION_COUNT) { this.btnPos = pos; this.renderButtons(); }
  }

  refreshButtons(): void { this.renderButtons(); }

  private renderButtons(): void {
    const $btns = this.$actionBtns.get();
    for (let i = 0; i < SECTION_COUNT; i++) {
      const def = PANEL_BUTTONS[i];
      const $btn = $btns.eq(i);
      const enabled = this.isSectionEnabled(def.section);
      if (def.instant) {
        $btn.toggleClass('hidden', !enabled);
      } else {
        $btn.toggleClass('disabled', !enabled);
      }
      const on = i === this.btnPos && this.btnsFocused && !this.sideOpen;
      if (on) $btn.addClass('focused'); else $btn.removeClass('focused');
    }
  }

  // --- side list ---

  openSideList(): void {
    this.sideOpen = true;
    this.listSection = this.currentSection();
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
    switch (this.listSection) {
      case Section.Audio:   this.cbs.onApplyAudio(this.listIndex); break;
      case Section.Subs:    this.cbs.onApplySub(this.listIndex); break;
      case Section.Quality: this.cbs.onApplyQuality(this.listIndex); break;
      case Section.SubSize: {
        const size = Storage.SUB_SIZE_MIN + this.listIndex * Storage.SUB_SIZE_STEP;
        this.cbs.onApplySubSize(size);
        break;
      }
      default: return;
    }
    this.cbs.onSavePrefs();
  }

  private renderSideList(): void {
    const items = this.getItems(this.listSection);
    const title = findBtn(this.listSection).label;
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
