import { router } from '../../router';
import { TvKey, platform } from '../../utils/platform';
import { PageKeys } from '../../utils/page';
import { Logger } from '../../utils/log';
import { showHlsError } from '../../utils/hls-error';
import { tplErrorScreen } from './error-template';
import { HlsEngine, HlsFatalErrorData } from './hls-engine';

export interface PlayerErrorViewDeps {
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

  showPlaybackError(error: MediaError | null, url: string): void {
    const msg = getVideoErrorMessage(error);
    const code = error ? error.code : 0;
    const detail = error && (error as { message?: string }).message ? (error as { message?: string }).message : '';
    const domain = this.deps.engine.getDomain();
    const curLevel = this.deps.engine.getCurrentLevel();
    const devInfo = platform.getDeviceInfo();
    this.deps.log.error('playbackError {code} {msg} {detail} {domain} hlsLevel={hlsLevel} hlsRes={hlsRes} videoCodec={vc} audioCodec={ac}', {
      code, msg, detail: detail || null, domain,
      url: url.substring(0, 120), ua: navigator.userAgent,
      hw: devInfo.hardware, sw: devInfo.software,
      hlsLevel: this.deps.engine.instance ? this.deps.engine.instance.currentLevel : null,
      hlsRes: curLevel ? curLevel.width + 'x' + curLevel.height : null,
      vc: curLevel ? curLevel.videoCodec || null : null,
      ac: curLevel ? curLevel.audioCodec || null : null,
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

  showHlsFatalError(data: HlsFatalErrorData): void {
    this.deps.onDestroy();
    showHlsError(this.deps.log, this.deps.$root, data, 'player');
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
