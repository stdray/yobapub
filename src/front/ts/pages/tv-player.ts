import $ from 'jquery';
import { Page, RouteParams } from '../types/app';
import { router } from '../router';
import { TvKey, platform } from '../utils/platform';
import { PageKeys, PageUtils } from '../utils/page';
import { Logger } from '../utils/log';
import { buildBaseHlsConfig, logPlaybackStart } from '../utils/hls-proxy';
import { getOptionalRewrittenHlsUrl } from './player/hls';
import { ProxyCategory } from '../utils/storage';
import { showHlsError } from '../utils/hls-error';
import Hls from 'hls.js';

const plog = new Logger('tv-player');

class TvPlayerPage implements Page {
  private readonly $root = $('#page-tv-player');
  private readonly keys = new PageKeys();

  private hls: Hls | null = null;
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

    plog.debug('HLS check', { hlsExists: !!Hls, hlsSupported: Hls && Hls.isSupported() });
    if (Hls && Hls.isSupported()) {
      this.startHlsPlayback(this.video, streamUrl);
    } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
      plog.info('Using native HLS playback');
      this.video.src = streamUrl;
    } else {
      plog.error('HLS not supported and native playback not available');
    }
  }

  private startHlsPlayback(videoEl: HTMLVideoElement, streamUrl: string): void {
    plog.info('Using HLS.js');
    const h = new Hls(buildBaseHlsConfig());
    this.hls = h;

    plog.newTraceId();
    logPlaybackStart(plog, streamUrl);

    streamUrl = getOptionalRewrittenHlsUrl(streamUrl, 0, ProxyCategory.Tv);

    this.bindHlsDebugEvents(h);
    this.bindHlsManifestParsed(h, videoEl);
    this.bindHlsError(h);

    h.loadSource(streamUrl);
    h.attachMedia(videoEl);
    plog.debug('HLS attached to video element');
  }

  private bindHlsDebugEvents(h: Hls): void {
    h.on(Hls.Events.MANIFEST_LOADING, (_e, data) => {
      plog.debug('HLS MANIFEST_LOADING', { url: data?.url ? data.url.substring(0, 120) : null });
    });
    h.on(Hls.Events.MANIFEST_LOADED, (_e, data) => {
      plog.debug('HLS MANIFEST_LOADED', { levels: data?.levels ? data.levels.length : 0 });
    });
    h.on(Hls.Events.LEVEL_LOADING, (_e, data) => {
      plog.debug('HLS LEVEL_LOADING', { level: data?.level, url: data?.url ? data.url.substring(0, 120) : null });
    });
    h.on(Hls.Events.LEVEL_LOADED, (_e, data) => {
      plog.debug('HLS LEVEL_LOADED', {
        level: data?.levelId,
        frags: data?.details?.fragments ? data.details.fragments.length : 0,
      });
    });
    h.on(Hls.Events.FRAG_LOADING, (_e, data) => {
      plog.debug('HLS FRAG_LOADING', {
        sn: data?.frag?.sn,
        url: data?.frag?.url ? data.frag.url.substring(0, 120) : null,
      });
    });
    h.on(Hls.Events.FRAG_LOADED, (_e, data) => {
      plog.debug('HLS FRAG_LOADED', { sn: data?.frag?.sn });
    });
  }

  private bindHlsManifestParsed(h: Hls, videoEl: HTMLVideoElement): void {
    h.on(Hls.Events.MANIFEST_PARSED, () => {
      plog.debug('HLS MANIFEST_PARSED');
      videoEl.play().catch((err: unknown) => {
        plog.warn('autoplay blocked, trying muted', { error: String(err) });
        videoEl.muted = true;
        videoEl.play().catch((err2: unknown) => {
          plog.error('muted play also failed', { error: String(err2) });
        });
      });
    });
  }

  private bindHlsError(h: Hls): void {
    h.on(Hls.Events.ERROR, (_event, data) => {
      const info = this.collectErrorInfo(data);
      plog.error('HLS error', info);

      if (data && data.fatal) {
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          plog.warn('Media error, attempting recovery');
          try { h.recoverMediaError(); } catch (e) { plog.error('Recovery failed', { error: String(e) }); }
        } else {
          this.stopPlayback();
          showHlsError(plog, this.$root, data, 'tv-player');
          this.keys.unbind();
          this.keys.bind((e: JQuery.Event) => {
            const kc = e.keyCode;
            if (kc === TvKey.Return || kc === TvKey.Backspace || kc === TvKey.Escape || kc === TvKey.Stop) {
              router.goBack();
              e.preventDefault();
            }
          });
        }
      }
    });
  }

  private collectErrorInfo(data: Hls.errorData): Record<string, unknown> {
    const info: Record<string, unknown> = { fatal: data?.fatal, type: data?.type };
    if (data?.details) info.details = String(data.details).substring(0, 100);
    if (data?.url) info.url = String(data.url).substring(0, 200);
    if (data?.networkDetails) {
      const nd = data.networkDetails as XMLHttpRequest;
      info.httpStatus = nd.status;
      info.httpStatusText = nd.statusText;
    }
    return info;
  }

  private stopPlayback(): void {
    plog.debug('stopPlayback called');
    if (this.hls) {
      plog.debug('destroying HLS instance');
      this.hls.destroy();
      this.hls = null;
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
