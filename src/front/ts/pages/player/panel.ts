import * as doT from 'dot';
import { AudioTrack, Subtitle, VideoFile } from '../../types/api';
import { TvKey } from '../../utils/platform';
import { Lazy } from '../../utils/lazy';

const tplListItemsCompiled = doT.template(
  '{{~it.items :item:i}}'
  + '<div class="ppanel__list-item{{?item.selected}} selected{{?}}{{?i===it.focusedIndex}} focused{{?}}">'
  + '{{=item.label}}'
  + '</div>'
  + '{{~}}'
);

const PANEL_SECTIONS = ['audio', 'subs', 'quality'] as const;
const PANEL_IDLE_MS = 4000;

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

export interface PanelCallbacks {
  readonly onShowInfo: () => void;
  readonly onAfterClose: () => void;
  readonly onApplyAudio: (idx: number) => void;
  readonly onApplySub: (menuIdx: number) => void;
  readonly onApplyQuality: (idx: number) => void;
  readonly onSavePrefs: () => void;
  readonly getData: () => PanelData;
}

export const buildAudioLabel = (a: AudioTrack): string => {
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
  private readonly $panel: Lazy<JQuery>;
  private readonly $list: Lazy<JQuery>;
  private readonly $buttons: Lazy<JQuery>;
  private readonly $btns: Lazy<JQuery>;

  open = false;
  private btnIndex = 0;
  private listOpen = false;
  private listIndex = 0;
  private listSection = 0;
  private idleTimer: number | null = null;

  constructor($root: JQuery, cbs: PanelCallbacks) {
    this.cbs = cbs;
    this.$panel = new Lazy(() => $root.find('.player__panel'));
    this.$list = new Lazy(() => $root.find('.ppanel__list'));
    this.$buttons = new Lazy(() => $root.find('.ppanel__buttons'));
    this.$btns = new Lazy(() => $root.find('.ppanel__btn'));
  }

  resetDomCache(): void {
    this.$panel.reset();
    this.$list.reset();
    this.$buttons.reset();
    this.$btns.reset();
  }

  // --- queries ---

  private getItems(section: number): ReadonlyArray<LabeledItem> {
    const d = this.cbs.getData();
    if (section === 0) return d.audioItems;
    if (section === 1) return d.subItems;
    return d.qualityItems;
  }

  private getSelectedLabel(section: number): string {
    const items = this.getItems(section);
    for (let i = 0; i < items.length; i++) {
      if (items[i].selected) return items[i].label;
    }
    return '...';
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
      this.forceClose();
    }, PANEL_IDLE_MS);
  }

  readonly clearIdle = (): void => {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  };

  // --- render ---

  private updateButtons(): void {
    const labels = ['Аудио: ', 'Сабы: ', 'Качество: '];
    const $btns = this.$btns.get();
    for (let i = 0; i < PANEL_SECTIONS.length; i++) {
      const $btn = $btns.eq(i);
      const enabled = this.isSectionEnabled(i);
      $btn.find('.ppanel__btn-label').html(
        labels[i] + (enabled ? this.getSelectedLabel(i) : '—'),
      );
      $btn.toggleClass('disabled', !enabled);
      if (i === this.btnIndex && !this.listOpen) {
        $btn.addClass('focused');
      } else {
        $btn.removeClass('focused');
      }
    }
  }

  private renderList(): void {
    const items = this.getItems(this.listSection);
    const $list = this.$list.get();
    $list.html(tplListItemsCompiled({ items, focusedIndex: this.listIndex }));
    this.scrollToFocused($list);
  }

  private scrollToFocused($list: JQuery): void {
    const el = $list.find('.ppanel__list-item.focused')[0];
    if (!el) return;
    const container = $list[0];
    if (!container) return;
    const top = el.offsetTop;
    const bot = top + el.offsetHeight;
    if (top < container.scrollTop) {
      container.scrollTop = top;
    } else if (bot > container.scrollTop + container.clientHeight) {
      container.scrollTop = bot - container.clientHeight;
    }
  }

  // --- open / close ---

  private forceClose(): void {
    if (!this.open) return;
    this.listOpen = false;
    this.open = false;
    this.$list.get().removeClass('active').addClass('hidden');
    this.$buttons.get().removeClass('active');
    this.$panel.get().addClass('hidden');
    this.cbs.onAfterClose();
  }

  readonly show = (): void => {
    if (this.open) return;
    this.open = true;
    this.listOpen = false;
    this.btnIndex = 0;
    while (this.btnIndex < PANEL_SECTIONS.length - 1 && !this.isSectionEnabled(this.btnIndex)) {
      this.btnIndex++;
    }
    this.cbs.onShowInfo();
    this.$panel.get().removeClass('hidden');
    this.updateButtons();
    setTimeout(() => {
      this.$buttons.get().addClass('active');
    }, 20);
    this.resetIdle();
  };

  private close(): void {
    if (!this.open) return;
    this.clearIdle();
    if (this.listOpen) {
      this.closeList();
      return;
    }
    this.open = false;
    this.$buttons.get().removeClass('active');
    setTimeout(() => {
      this.$panel.get().addClass('hidden');
      this.cbs.onAfterClose();
    }, 200);
  }

  private openList(): void {
    this.listOpen = true;
    this.listSection = this.btnIndex;
    const items = this.getItems(this.listSection);
    this.listIndex = 0;
    for (let i = 0; i < items.length; i++) {
      if (items[i].selected) { this.listIndex = i; break; }
    }
    this.renderList();
    this.updateButtons();
    this.$buttons.get().removeClass('active');
    this.$list.get().removeClass('hidden');
    setTimeout(() => {
      this.$list.get().addClass('active');
    }, 20);
  }

  private closeList(): void {
    this.listOpen = false;
    this.$list.get().removeClass('active');
    setTimeout(() => {
      this.$list.get().addClass('hidden');
      this.$buttons.get().addClass('active');
      this.updateButtons();
    }, 200);
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
    this.updateButtons();
    this.renderList();
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
        while (idx < PANEL_SECTIONS.length && !this.isSectionEnabled(idx)) idx++;
        if (idx < PANEL_SECTIONS.length) { this.btnIndex = idx; this.updateButtons(); }
        e.preventDefault(); break;
      }
      case TvKey.Enter:
        if (this.isSectionEnabled(this.btnIndex)) this.openList();
        e.preventDefault(); break;
      case TvKey.Return: case TvKey.Backspace: case TvKey.Escape: case TvKey.Down:
        this.close(); e.preventDefault(); break;
    }
  };

  private handleListKey(e: JQuery.Event, kc: number): void {
    const items = this.getItems(this.listSection);
    switch (kc) {
      case TvKey.Up:
        if (this.listIndex > 0) { this.listIndex--; this.renderList(); }
        e.preventDefault(); break;
      case TvKey.Down:
        if (this.listIndex < items.length - 1) { this.listIndex++; this.renderList(); }
        e.preventDefault(); break;
      case TvKey.Enter:
        if (items[this.listIndex] && !items[this.listIndex].selected) {
          this.applySelection();
        }
        this.closeList();
        e.preventDefault(); break;
      case TvKey.Return: case TvKey.Backspace: case TvKey.Escape:
        this.closeList(); e.preventDefault(); break;
    }
  }

  readonly reset = (): void => {
    this.open = false;
    this.btnIndex = 0;
    this.listOpen = false;
    this.listIndex = 0;
    this.listSection = 0;
    this.clearIdle();
  };
}
