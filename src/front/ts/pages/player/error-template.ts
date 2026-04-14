import * as doT from 'dot';

export interface ErrorScreenData {
  readonly prefix: 'player' | 'tv-player';
  readonly msg: string;
  readonly debugLines: ReadonlyArray<string>;
}

const tplCompiled = doT.template(`
  <div class="{{=it.prefix}}">
    <div class="{{=it.prefix}}__error">
      <div>{{=it.msg}}</div>
      {{~it.debugLines :line}}<div class="player__error-debug">{{=line}}</div>{{~}}
    </div>
  </div>
`);

export const tplErrorScreen = (data: ErrorScreenData): string => tplCompiled(data);
