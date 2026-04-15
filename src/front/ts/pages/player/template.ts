import * as doT from 'dot';

interface PlayerTplButton {
  readonly section: number;
  readonly label: string;
  readonly instant: boolean;
}

interface PlayerTplData {
  readonly title: string;
  readonly episode: string;
  readonly buttons: ReadonlyArray<PlayerTplButton>;
}

const tplPlayerCompiled = doT.template(`
  <div class="player">
    <video></video>
    <div class="player__spinner"><div class="spinner__circle"></div></div>
    <div class="player__info hidden"></div>
    <div class="player__osd hidden"></div>
    <div class="player__gradient hidden"></div>
    <div class="player__header hidden">
      <div class="player__title">{{=it.title}}</div>
      <div class="player__episode">{{=it.episode}}</div>
    </div>
    <div class="player__bar hidden">
      <div class="player__bar-wrap">
        <div class="player__actions">
          {{~it.buttons :b}}
            <div class="player__action-btn{{?b.instant}} hidden{{?}}" data-section="{{=b.section}}">{{=b.label}}</div>
          {{~}}
        </div>
        <div class="player__bar-progress">
          <div class="player__bar-value">
            <div class="player__bar-pct"></div>
          </div>
          <div class="player__bar-seek"></div>
        </div>
        <div class="player__bar-duration"></div>
      </div>
    </div>
    <div class="player__side-panel hidden"></div>
  </div>
`);

export const tplPlayer = (data: PlayerTplData): string => tplPlayerCompiled(data);

interface ErrorScreenData {
  readonly prefix: 'player' | 'tv-player';
  readonly msg: string;
  readonly debugLines: ReadonlyArray<string>;
}

const tplErrorScreenCompiled = doT.template(`
  <div class="{{=it.prefix}}">
    <div class="{{=it.prefix}}__error">
      <div>{{=it.msg}}</div>
      {{~it.debugLines :line}}<div class="player__error-debug">{{=line}}</div>{{~}}
    </div>
  </div>
`);

export const tplErrorScreen = (data: ErrorScreenData): string => tplErrorScreenCompiled(data);

interface SidePanelItem {
  readonly label: string;
  readonly selected: boolean;
}

interface SidePanelData {
  readonly title: string;
  readonly items: ReadonlyArray<SidePanelItem>;
  readonly focusedIndex: number;
}

const tplSidePanelCompiled = doT.template(`
  <div class="player__side-panel__title">{{=it.title}}</div>
  {{~it.items :item:i}}
    <div class="player__side-item{{?item.selected}} selected{{?}}{{?i===it.focusedIndex}} focused{{?}}">
      {{=item.label}}
    </div>
  {{~}}
`);

export const tplSidePanel = (data: SidePanelData): string => tplSidePanelCompiled(data);
