import $ from 'jquery';
import Hls from 'hls.js';
import { Page, RouteParams } from '../types/app';
import { router } from '../router';
import { TvKey } from '../utils/platform';
import { PageKeys, PageUtils } from '../utils/page';
import { Logger } from '../utils/log';
import { loadItemWithWatching } from '../api/items';
import { MediaService } from './player/media';
import { VideoFile } from '../types/api';
import { getRewrittenHlsUrl } from '../utils/hls-utils';
import { ProxyCategory } from '../utils/storage';

// Minimal HLS playback page for testing default hls.js behavior without any
// of the main player's config/patches (no custom buffer limits, no pinning,
// no URL rewriting, no seek handling, no overlay). Just <video autoplay> +
// `new Hls()` with defaults + loadSource + attachMedia. Entry point is a
// "Тестовый просмотр" button on the movie page.

const log = new Logger('test-player');

const pickHls4 = (f: VideoFile): string =>
  (f.urls && f.urls.hls4) || (f.url && f.url.hls4) || '';

class TestPlayerPage implements Page {
  private readonly $root = $('#page-test-player');
  private readonly keys = new PageKeys();
  private readonly mediaService = new MediaService();

  private hls: Hls | null = null;
  private video: HTMLVideoElement | null = null;

  private readonly handleKey = (e: JQuery.Event): void => {
    const kc = e.keyCode;
    if (kc === TvKey.Return || kc === TvKey.Backspace || kc === TvKey.Escape) {
      router.goBack();
      e.preventDefault();
    }
  };

  private showMessage(msg: string): void {
    this.$root.html(
      '<div style="position:absolute;left:0;top:0;right:0;bottom:0;display:flex;' +
      'align-items:center;justify-content:center;color:#fff;background:#000;' +
      'font-size:32px">' + msg + '</div>',
    );
  }

  private startPlayback(url: string): void {
    log.info('start url={url} hlsVer={v} supported={s}', {
      url, v: Hls.version || 'unknown', s: Hls.isSupported(),
    });

    this.$root.html(
      '<video id="test-player-video" autoplay playsinline ' +
      'style="position:absolute;left:0;top:0;width:100%;height:100%;background:#000"></video>',
    );
    const video = this.$root.find('#test-player-video').get(0) as HTMLVideoElement;
    this.video = video;

    video.addEventListener('playing', () => log.info('video playing ct={ct}', { ct: video.currentTime }));
    video.addEventListener('waiting', () => log.info('video waiting ct={ct}', { ct: video.currentTime }));
    video.addEventListener('stalled', () => log.info('video stalled ct={ct}', { ct: video.currentTime }));
    video.addEventListener('error', () => {
      const err = video.error;
      log.error('video error code={code} msg={msg}', {
        code: err ? err.code : -1,
        msg: err ? err.message : '',
      });
    });

    const h = new Hls();
    this.hls = h;

    h.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
      log.info('MANIFEST_PARSED levels={n}', { n: data?.levels ? data.levels.length : 0 });
    });
    h.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
      const lvl = h.levels && h.levels[data.level];
      log.info('LEVEL_SWITCHED level={l} {w}x{h} br={br} vc={vc}', {
        l: data.level,
        w: lvl ? lvl.width : 0,
        h: lvl ? lvl.height : 0,
        br: lvl ? lvl.bitrate : 0,
        vc: lvl ? (lvl.videoCodec || '') : '',
      });
    });
    h.on(Hls.Events.ERROR, (_e, data) => {
      log.error('ERROR type={t} details={d} fatal={f}', {
        t: data.type, d: data.details, f: data.fatal,
      });
    });

    h.loadSource(url);
    h.attachMedia(video);
  }

  mount(params: RouteParams): void {
    this.keys.bind(this.handleKey);

    if (!params.id) {
      this.showMessage('Нет id');
      return;
    }

    PageUtils.showSpinnerIn(this.$root);
    log.info('mount id={id}', { id: params.id });

    loadItemWithWatching(params.id,
      (item) => {
        const video = item.videos && item.videos[0];
        if (!video) {
          log.error('no videos on item');
          this.showMessage('У фильма нет видео');
          return;
        }
        this.mediaService.loadLinks(video.id, (files) => {
          if (files.length === 0) {
            log.error('no files from media-links');
            this.showMessage('Нет файлов');
            return;
          }
          const sorted = files.slice().sort((a, b) => b.w - a.w);
          const rawUrl = pickHls4(sorted[0]);
          if (!rawUrl) {
            log.error('no hls4 url on best file w={w} h={h}', { w: sorted[0].w, h: sorted[0].h });
            this.showMessage('Нет HLS4 URL');
            return;
          }
          this.startPlayback(getRewrittenHlsUrl(rawUrl, 0, ProxyCategory.Media));
        });
      },
      () => {
        log.error('loadItem failed');
        this.showMessage('Ошибка загрузки');
      },
    );
  }

  unmount(): void {
    this.keys.unbind();
    if (this.hls) {
      try { this.hls.destroy(); } catch (_) { /* ignore */ }
      this.hls = null;
    }
    if (this.video) {
      try { this.video.src = ''; } catch (_) { /* ignore */ }
      this.video = null;
    }
    PageUtils.clearPage(this.$root);
  }
}

export const testPlayerPage = new TestPlayerPage();
