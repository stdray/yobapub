import { router } from '../../router';
import { TvKey, platform } from '../../utils/platform';
import { PageKeys } from '../../utils/page';
import { Logger } from '../../utils/log';
import { showHlsError } from '../../utils/hls-utils';
import { tplErrorScreen } from './template';
import { HlsEngine, HlsErrorSnapshot } from './hls-engine';
import { HlsError } from './hls-adapter';

interface PlayerErrorViewDeps {
  readonly $root: JQuery;
  readonly keys: PageKeys;
  readonly engine: HlsEngine;
  readonly onDestroy: () => void;
  readonly log: Logger;
}

const getVideoErrorMessage = (error: MediaError | null): string => {
  if (!error) return 'Неизвестная ошибка воспроизведения';
  switch (error.code) {
    case MediaError.MEDIA_ERR_ABORTED:
      return 'Воспроизведение прервано';
    case MediaError.MEDIA_ERR_NETWORK:
      return 'Ошибка сети при загрузке видео';
    case MediaError.MEDIA_ERR_DECODE:
      return 'Ошибка декодирования видео (формат не поддерживается устройством)';
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'Формат видео не поддерживается (Tizen 2.3 не может воспроизвести этот поток)';
    default:
      return 'Ошибка воспроизведения (код: ' + error.code + ')';
  }
};

export class PlayerErrorView {
  constructor(private readonly deps: PlayerErrorViewDeps) {}

  // `snapshot` must be the one captured by video-bindings.ts's `error`
  // listener at the moment the event fired — re-reading engine/video state
  // here would be too late: by this point onFatalError has already run and
  // currentLevel/currentTime can read as reset/detached (-1/0/[none]).
  showPlaybackError(error: MediaError | null, url: string, snapshot: HlsErrorSnapshot): void {
    const msg = getVideoErrorMessage(error);
    const code = error ? error.code : 0;
    const detail = error && (error as { message?: string }).message ? (error as { message?: string }).message : '';
    const domain = this.deps.engine.getDomain();
    const devInfo = platform.getDeviceInfo();
    this.deps.log.error('playbackError {code} {msg} {detail} {domain} hlsLevel={hlsLevel} hlsRes={hlsRes}'
      + ' videoCodec={vc} audioCodec={ac} decodedFrames={frames} ct={ct} readyState={rs} buffered={br}'
      + ' lastFragSn={fsn} lastFragStart={fstart} lastFragSize={fsize}', {
      code, msg, detail: detail || null, domain,
      url: url.substring(0, 120), ua: navigator.userAgent,
      hw: devInfo.hardware, sw: devInfo.software,
      hlsLevel: snapshot.levelIndex,
      hlsRes: snapshot.level ? snapshot.level.width + 'x' + snapshot.level.height : null,
      vc: snapshot.level ? snapshot.level.videoCodec : null,
      ac: snapshot.level ? snapshot.level.audioCodec : null,
      frames: snapshot.decodedFrames,
      ct: snapshot.ct,
      rs: snapshot.readyState,
      br: snapshot.buffered,
      fsn: snapshot.lastFragSn,
      fstart: snapshot.lastFragStart,
      fsize: snapshot.lastFragSize,
    });
    this.deps.onDestroy();
    const debugLines: string[] = [];
    if (domain) debugLines.push(domain);
    debugLines.push('Код ошибки: ' + code);
    debugLines.push(navigator.userAgent);
    this.deps.$root.html(tplErrorScreen({ prefix: 'player', msg, debugLines }));
    this.bindBackKeys();
  }

  showMessage(text: string): void {
    this.deps.$root.html(tplErrorScreen({ prefix: 'player', msg: text, debugLines: [] }));
  }

  showHlsFatalError(err: HlsError): void {
    this.deps.onDestroy();
    showHlsError(this.deps.log, this.deps.$root, err, 'player');
    this.bindBackKeys();
  }

  private bindBackKeys(): void {
    this.deps.keys.unbind();
    this.deps.keys.bind((e: JQuery.Event) => {
      const orig = (e as { originalEvent?: KeyboardEvent }).originalEvent;
      const kc = (orig && orig.keyCode) ? orig.keyCode : (e.keyCode || 0);
      if (kc === TvKey.Return || kc === TvKey.Backspace || kc === TvKey.Escape) {
        router.goBack();
        e.preventDefault();
      }
    });
  }
}
