import $ from 'jquery';
import { Page, RouteParams } from '../types/app';
import { router } from '../router';
import { TvKey } from '../utils/platform';
import { PageKeys, PageUtils } from '../utils/page';
import { Logger } from '../utils/log';
import { buildBaseHlsConfig, logPlaybackStart } from '../utils/hls-proxy';
import { storage } from '../utils/storage';
import { showHlsError } from '../utils/hls-error';

const $root = $('#page-tv-player');
const keys = new PageKeys();
const plog = new Logger('tv-player');
let hls: any = null;
let video: HTMLVideoElement | null = null;
let overlayTimer: number | null = null;

const clearOverlayTimer = (): void => {
  if (overlayTimer !== null) { clearTimeout(overlayTimer); overlayTimer = null; }
};

const showOverlay = (autoHide = true): void => {
  clearOverlayTimer();
  $root.find('.tv-player__overlay').removeClass('hidden');
  if (autoHide) {
    overlayTimer = window.setTimeout(() => {
      $root.find('.tv-player__overlay').addClass('hidden');
    }, 3000);
  }
};

function render(title: string): void {
  plog.debug('render called', { title });
  $root.html(
    '<div class="tv-player">' +
      '<video class="tv-player__video" autoplay></video>' +
      '<div class="tv-player__spinner"><div class="spinner"><div class="spinner__circle"></div></div></div>' +
      '<div class="tv-player__overlay">' +
        '<div class="tv-player__title">' + title + '</div>' +
      '</div>' +
    '</div>'
  );
  video = $root.find('video')[0] as HTMLVideoElement;
  plog.debug('video element rendered', { videoExists: !!video });

  if (video) {
    const v = video;
    // Логирование видео-событий
    video.addEventListener('play', () => plog.debug('video: play'));
    video.addEventListener('playing', () => {
      plog.debug('video: playing');
      $root.find('.tv-player__spinner').hide();
      showOverlay();
    });
    video.addEventListener('pause', () => {
      plog.debug('video: pause');
      showOverlay(false);
    });
    video.addEventListener('ended', () => plog.debug('video: ended'));
    video.addEventListener('error', (e) => {
      const err = video?.error;
      plog.error('video: error', {
        code: err?.code,
        message: err?.message
      });
    });
    video.addEventListener('stalled', () => plog.debug('video: stalled'));
    video.addEventListener('waiting', () => {
      plog.debug('video: waiting');
      $root.find('.tv-player__spinner').show();
    });
    video.addEventListener('loadstart', () => plog.debug('video: loadstart'));
    video.addEventListener('progress', () => plog.debug('video: progress'));
    video.addEventListener('suspend', () => plog.debug('video: suspend'));
    video.addEventListener('abort', () => plog.debug('video: abort'));
    video.addEventListener('emptied', () => plog.debug('video: emptied'));
    video.addEventListener('loadedmetadata', () => plog.debug('video: loadedmetadata'));
    video.addEventListener('loadeddata', () => plog.debug('video: loadeddata'));
    video.addEventListener('canplay', () => plog.debug('video: canplay'));
    video.addEventListener('canplaythrough', () => plog.debug('video: canplaythrough'));
    video.addEventListener('durationchange', () => plog.debug('video: durationchange', { duration: v.duration }));
    video.addEventListener('timeupdate', () => {
      // Not logging timeupdate as it fires constantly
    });
    video.addEventListener('ratechange', () => plog.debug('video: ratechange'));
    video.addEventListener('seeking', () => plog.debug('video: seeking'));
    video.addEventListener('seeked', () => plog.debug('video: seeked'));
    video.addEventListener('volumechange', () => plog.debug('video: volumechange'));
  }
}

function startPlayback(streamUrl: string): void {
  plog.debug('startPlayback called', { streamUrl: streamUrl.substring(0, 80), videoExists: !!video });
  if (!video) {
    plog.error('video element not found');
    return;
  }
  const HlsCtor = (window as any).Hls;
  plog.debug('HLS check', { hlsExists: !!HlsCtor, hlsSupported: HlsCtor && HlsCtor.isSupported() });
  if (HlsCtor && HlsCtor.isSupported()) {
    plog.info('Using HLS.js');

    const hlsConfig: Record<string, any> = buildBaseHlsConfig();

    if (storage.isProxyTv()) {
      plog.debug('Proxy enabled, will rewrite URLs');
      streamUrl = '/hls/rewrite?url=' + encodeURIComponent(streamUrl) + '&audio=0&proxy=true';
    }

    hls = new HlsCtor(hlsConfig);
    logPlaybackStart(plog, streamUrl);

    // Register all events before loadSource/attachMedia
    hls.on(HlsCtor.Events.MANIFEST_LOADING, (_e: unknown, data: { url?: string }) => {
      plog.debug('HLS MANIFEST_LOADING', { url: data?.url ? data.url.substring(0, 120) : null });
    });
    hls.on(HlsCtor.Events.MANIFEST_LOADED, (_e: unknown, data: { levels?: unknown[] }) => {
      plog.debug('HLS MANIFEST_LOADED', { levels: data?.levels ? data.levels.length : 0 });
    });
    hls.on(HlsCtor.Events.LEVEL_LOADING, (_e: unknown, data: { url?: string; level?: number }) => {
      plog.debug('HLS LEVEL_LOADING', { level: data?.level, url: data?.url ? data.url.substring(0, 120) : null });
    });
    hls.on(HlsCtor.Events.LEVEL_LOADED, (_e: unknown, data: { level?: number; details?: { fragments?: unknown[] } }) => {
      plog.debug('HLS LEVEL_LOADED', { level: data?.level, frags: data?.details?.fragments ? data.details.fragments.length : 0 });
    });
    hls.on(HlsCtor.Events.FRAG_LOADING, (_e: unknown, data: { frag?: { sn: number; url?: string } }) => {
      plog.debug('HLS FRAG_LOADING', { sn: data?.frag?.sn, url: data?.frag?.url ? data.frag.url.substring(0, 120) : null });
    });
    hls.on(HlsCtor.Events.FRAG_LOADED, (_e: unknown, data: { frag?: { sn: number } }) => {
      plog.debug('HLS FRAG_LOADED', { sn: data?.frag?.sn });
    });

    hls.on(HlsCtor.Events.MANIFEST_PARSED, () => {
      plog.debug('HLS MANIFEST_PARSED');
      if (video) {
        video.play().catch((err: unknown) => {
          plog.warn('autoplay blocked, trying muted', { error: String(err) });
          if (video) {
            video.muted = true;
            video.play().catch((err2: unknown) => {
              plog.error('muted play also failed', { error: String(err2) });
            });
          }
        });
      }
    });

    hls.on(HlsCtor.Events.ERROR, (event: unknown, data: any) => {
      const errorInfo: Record<string, unknown> = {
        fatal: data?.fatal,
        type: data?.type
      };
      if (data?.details) errorInfo.details = String(data.details).substring(0, 100);
      if (data?.error) errorInfo.error = String(data.error).substring(0, 200);
      if (data?.reason) errorInfo.reason = String(data.reason).substring(0, 200);
      if (data?.response) {
        errorInfo.responseCode = data.response.code;
        if (data.response.text) errorInfo.responseText = String(data.response.text).substring(0, 200);
      }
      if (data?.url) errorInfo.url = String(data.url).substring(0, 200);
      if (data?.frag) {
        errorInfo.fragSn = data.frag.sn;
        errorInfo.fragUrl = data.frag.url ? String(data.frag.url).substring(0, 200) : undefined;
        errorInfo.fragLevel = data.frag.level;
      }
      if (data?.context) {
        errorInfo.ctxUrl = data.context.url ? String(data.context.url).substring(0, 200) : undefined;
        errorInfo.ctxType = data.context.type;
      }
      if (data?.networkDetails) {
        const nd = data.networkDetails as XMLHttpRequest;
        errorInfo.httpStatus = nd.status;
        errorInfo.httpStatusText = nd.statusText;
      }
      if (data?.level !== undefined) errorInfo.level = data.level;
      if (data?.buffer !== undefined) errorInfo.buffer = data.buffer;

      plog.error('HLS error', errorInfo);

      if (data && data.fatal) {
        if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
          plog.warn('Media error, attempting recovery');
          try {
            hls.recoverMediaError();
          } catch (e) {
            plog.error('Recovery failed', { error: String(e) });
          }
        } else {
          stopPlayback();
          showHlsError(plog, $root, data, 'tv-player');
          keys.unbind();
          keys.bind((e: JQuery.Event) => {
            if (e.keyCode === TvKey.Return || e.keyCode === TvKey.Backspace ||
                e.keyCode === TvKey.Escape || e.keyCode === TvKey.Stop) {
              router.goBack();
              e.preventDefault();
            }
          });
        }
      }
    });

    hls.loadSource(streamUrl);
    hls.attachMedia(video);
    plog.debug('HLS attached to video element');
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    plog.info('Using native HLS playback');
    video.src = streamUrl;
  } else {
    plog.error('HLS not supported and native playback not available');
  }
}

function stopPlayback(): void {
  plog.debug('stopPlayback called');
  if (hls) {
    plog.debug('destroying HLS instance');
    hls.destroy();
    hls = null;
  }
  if (video) {
    plog.debug('clearing video element');
    video.pause();
    video.src = '';
    video = null;
  }
}

const handleKey = (e: JQuery.Event): void => {
  plog.debug('handleKey', { keyCode: e.keyCode });
  switch (e.keyCode) {
    case TvKey.Enter:
      if (video) {
        if (video.paused) {
          plog.debug('play pressed');
          video.play().catch((err) => {
            plog.error('play() failed', { error: String(err) });
          });
        } else {
          plog.debug('pause pressed');
          video.pause();
        }
      }
      e.preventDefault(); break;
    case TvKey.Return:
    case TvKey.Backspace:
    case TvKey.Escape:
    case TvKey.Stop:
      plog.debug('stop/back pressed');
      stopPlayback();
      router.goBack();
      e.preventDefault(); break;
  }
};

export const tvPlayerPage: Page = {
  mount(params: RouteParams): void {
    plog.info('tvPlayerPage mount', {
      channelTitle: params.channelTitle,
      channelStream: params.channelStream ? params.channelStream.substring(0, 80) : 'N/A'
    });
    render(params.channelTitle || '');
    startPlayback(params.channelStream || '');
    keys.bind(handleKey);
  },
  unmount(): void {
    plog.debug('tvPlayerPage unmount');
    clearOverlayTimer();
    stopPlayback();
    keys.unbind();
    PageUtils.clearPage($root);
  }
};
