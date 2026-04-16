import $ from 'jquery';
import { Page, RouteParams } from '../types/app';
import { router } from '../router';
import { TvKey, platform } from '../utils/platform';
import { PageKeys, PageUtils } from '../utils/page';
import { Logger } from '../utils/log';
import { buildBaseHlsConfig, logPlaybackStart, getOptionalRewrittenHlsUrl, showHlsError } from '../utils/hls-utils';
import { ProxyCategory } from '../utils/storage';
import { HlsAdapter, HlsError, createHlsAdapter } from './player/hls-adapter';
import { tplErrorScreen } from './player/template';

const plog = new Logger('tv-player');

const ERROR_TYPE_MEDIA = 'mediaError';

class TvPlayerPage implements Page {
  private readonly $root = $('#page-tv-player');
  private readonly keys = new PageKeys();

  private adapter: HlsAdapter | null = null;
  private video: HTMLVideoElement | null = null;
  private overlayTimer: number | null = null;

  // --- overlay ---

  private clearOverlayTimer(): void {
    if (this.overlayTimer !== null) {
      clearTimeout(this.overlayTimer);
      this.overlayTimer = null;
    }
  }

  private showOverlay(autoHide = true): void {
    this.clearOverlayTimer();
    this.$root.find('.tv-player__overlay').removeClass('hidden');
    if (autoHide) {
      this.overlayTimer = window.setTimeout(() => {
        this.$root.find('.tv-player__overlay').addClass('hidden');
      }, 3000);
    }
  }

  // --- render ---

  private render(title: string): void {
    plog.debug('render called', { title });
    this.$root.html(
      '<div class="tv-player">' +
        '<video class="tv-player__video" autoplay></video>' +
        '<div class="tv-player__spinner"><div class="spinner"><div class="spinner__circle"></div></div></div>' +
        '<div class="tv-player__overlay">' +
          '<div class="tv-player__title">' + title + '</div>' +
        '</div>' +
      '</div>',
    );
    this.video = this.$root.find('video')[0] as HTMLVideoElement;
    plog.debug('video element rendered', { videoExists: !!this.video });

    if (this.video) {
      this.bindVideoEvents(this.video);
    }
  }

  private bindVideoEvents(v: HTMLVideoElement): void {
    v.addEventListener('play', () => plog.debug('video: play'));
    v.addEventListener('playing', () => {
      plog.debug('video: playing');
      this.$root.find('.tv-player__spinner').hide();
      this.showOverlay();
    });
    v.addEventListener('pause', () => {
      plog.debug('video: pause');
      this.showOverlay(false);
    });
    v.addEventListener('ended', () => plog.debug('video: ended'));
    v.addEventListener('error', () => {
      const err = v.error;
      const devInfo = platform.getDeviceInfo();
      plog.error('video: error', {
        code: err?.code, message: err?.message,
        ua: navigator.userAgent, hw: devInfo.hardware, sw: devInfo.software,
      });
    });
    v.addEventListener('stalled', () => plog.debug('video: stalled'));
    v.addEventListener('waiting', () => {
      plog.debug('video: waiting');
      this.$root.find('.tv-player__spinner').show();
    });
    v.addEventListener('loadstart', () => plog.debug('video: loadstart'));
    v.addEventListener('progress', () => plog.debug('video: progress'));
    v.addEventListener('suspend', () => plog.debug('video: suspend'));
    v.addEventListener('abort', () => plog.debug('video: abort'));
    v.addEventListener('emptied', () => plog.debug('video: emptied'));
    v.addEventListener('loadedmetadata', () => plog.debug('video: loadedmetadata'));
    v.addEventListener('loadeddata', () => plog.debug('video: loadeddata'));
    v.addEventListener('canplay', () => plog.debug('video: canplay'));
    v.addEventListener('canplaythrough', () => plog.debug('video: canplaythrough'));
    v.addEventListener('durationchange', () => plog.debug('video: durationchange', { duration: v.duration }));
    v.addEventListener('ratechange', () => plog.debug('video: ratechange'));
    v.addEventListener('seeking', () => plog.debug('video: seeking'));
    v.addEventListener('seeked', () => plog.debug('video: seeked'));
    v.addEventListener('volumechange', () => plog.debug('video: volumechange'));
  }

  // --- playback ---

  private startPlayback(streamUrl: string): void {
    plog.debug('startPlayback called', { streamUrl: streamUrl.substring(0, 80), videoExists: !!this.video });
    if (!this.video) { plog.error('video element not found'); return; }

    plog.debug('HLS check', { supported: HlsAdapter.isSupported() });
    if (HlsAdapter.isSupported()) {
      this.startHlsPlayback(this.video, streamUrl);
    } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
      plog.info('Using native HLS playback');
      this.video.src = streamUrl;
    } else {
      plog.error('HLS not supported and native playback not available');
      this.$root.html(tplErrorScreen({
        prefix: 'tv-player',
        msg: 'Устройство не поддерживает воспроизведение видео',
        debugLines: [navigator.userAgent],
      }));
    }
  }

  private startHlsPlayback(videoEl: HTMLVideoElement, streamUrl: string): void {
    plog.info('Using HLS.js version={v}', { v: HlsAdapter.runtimeVersion });
    const adapter = createHlsAdapter(buildBaseHlsConfig(), plog);
    this.adapter = adapter;

    logPlaybackStart(plog, streamUrl);

    const rewrittenUrl = getOptionalRewrittenHlsUrl(streamUrl, 0, ProxyCategory.Tv);

    this.bindHlsDebugEvents(adapter);
    adapter.onManifestParsed(() => {
      plog.debug('HLS MANIFEST_PARSED');
      videoEl.play().catch((err: unknown) => {
        plog.warn('autoplay blocked, trying muted', { error: String(err) });
        videoEl.muted = true;
        videoEl.play().catch((err2: unknown) => {
          plog.error('muted play also failed', { error: String(err2) });
        });
      });
    });
    this.bindHlsError(adapter);

    adapter.loadSource(rewrittenUrl);
    adapter.attachMedia(videoEl);
    plog.debug('HLS attached to video element');
  }

  private bindHlsDebugEvents(adapter: HlsAdapter): void {
    adapter.onManifestLoaded((m) => {
      plog.debug('HLS MANIFEST_LOADED', { levels: m.levelCount });
    });
    adapter.onLevelLoading((l) => {
      plog.debug('HLS LEVEL_LOADING', { level: l.level, url: l.url ? l.url.substring(0, 120) : null });
    });
    adapter.onLevelLoaded((l) => {
      plog.debug('HLS LEVEL_LOADED', { level: l.levelId, loadMs: l.loadMs });
    });
    adapter.onFragLoading((frag) => {
      plog.debug('HLS FRAG_LOADING', { sn: frag.sn, url: frag.url ? frag.url.substring(0, 120) : null });
    });
    adapter.onFragLoaded((p) => {
      plog.debug('HLS FRAG_LOADED', { sn: p.frag.sn });
    });
  }

  private bindHlsError(adapter: HlsAdapter): void {
    adapter.onError((err: HlsError) => {
      plog.error('HLS error', {
        fatal: err.fatal, type: err.type,
        details: err.details.substring(0, 100),
        httpStatus: err.httpStatus,
        url: err.url ? err.url.substring(0, 200) : null,
      });

      if (!err.fatal) return;

      if (err.type === ERROR_TYPE_MEDIA) {
        plog.warn('Media error, attempting recovery');
        try { adapter.recoverMediaError(); } catch (e) { plog.error('Recovery failed', { error: String(e) }); }
        return;
      }

      this.stopPlayback();
      showHlsError(plog, this.$root, err, 'tv-player');
      this.keys.unbind();
      this.keys.bind((e: JQuery.Event) => {
        const kc = e.keyCode;
        if (kc === TvKey.Return || kc === TvKey.Backspace || kc === TvKey.Escape || kc === TvKey.Stop) {
          router.goBack();
          e.preventDefault();
        }
      });
    });
  }

  private stopPlayback(): void {
    plog.debug('stopPlayback called');
    if (this.adapter) {
      plog.debug('destroying HLS instance');
      this.adapter.destroy();
      this.adapter = null;
    }
    if (this.video) {
      plog.debug('clearing video element');
      this.video.pause();
      this.video.src = '';
      this.video = null;
    }
  }

  // --- keys ---

  private readonly handleKey = (e: JQuery.Event): void => {
    plog.debug('handleKey', { keyCode: e.keyCode });
    switch (e.keyCode) {
      case TvKey.Enter:
        if (this.video) {
          if (this.video.paused) {
            plog.debug('play pressed');
            this.video.play().catch((err) => {
              plog.error('play() failed', { error: String(err) });
            });
          } else {
            plog.debug('pause pressed');
            this.video.pause();
          }
        }
        e.preventDefault(); break;
      case TvKey.Return:
      case TvKey.Backspace:
      case TvKey.Escape:
      case TvKey.Stop:
        plog.debug('stop/back pressed');
        this.stopPlayback();
        router.goBack();
        e.preventDefault(); break;
    }
  };

  // --- Page ---

  mount(params: RouteParams): void {
    plog.info('tvPlayerPage mount', {
      channelTitle: params.channelTitle,
      channelStream: params.channelStream ? params.channelStream.substring(0, 80) : 'N/A',
    });
    this.render(params.channelTitle || '');
    this.startPlayback(params.channelStream || '');
    this.keys.bind(this.handleKey);
  }

  unmount(): void {
    plog.debug('tvPlayerPage unmount');
    this.clearOverlayTimer();
    this.stopPlayback();
    this.keys.unbind();
    PageUtils.clearPage(this.$root);
  }
}

export const tvPlayerPage = new TvPlayerPage();
