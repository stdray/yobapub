import * as doT from 'dot';

export var tplPlayer = doT.template(`
  <div class="player">
    <video preload="auto"></video>
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
        <div class="player__bar-progress">
          <div class="player__bar-value">
            <div class="player__bar-pct"></div>
          </div>
          <div class="player__bar-seek"></div>
        </div>
        <div class="player__bar-duration"></div>
      </div>
    </div>
    <div class="player__panel hidden">
      <div class="ppanel__overlay"></div>
      <div class="ppanel__buttons">
        <div class="ppanel__btn ppanel__btn--audio">
          <span class="ppanel__btn-label">Аудио: ...</span>
        </div>
        <div class="ppanel__btn ppanel__btn--subs">
          <span class="ppanel__btn-label">Сабы: ...</span>
        </div>
        <div class="ppanel__btn ppanel__btn--quality">
          <span class="ppanel__btn-label">Качество: ...</span>
        </div>
      </div>
      <div class="ppanel__list hidden"></div>
    </div>
    <div class="player__toast hidden"></div>
  </div>
`);
