import $ from 'jquery';
import { Page, RouteParams } from '../types/app';
import { goBack } from '../router';
import { TvKey } from '../utils/platform';
import { pageKeys, clearPage } from '../utils/page';
import { Logger } from '../utils/log';

const $root = $('#page-tv-player');
const keys = pageKeys();
const plog = new Logger('tv-player');
let hls: any = null;
let video: HTMLVideoElement | null = null;

function render(title: string): void {
  plog.debug('render called', { title });
  $root.html(
    '<div class="tv-player">' +
      '<video class="tv-player__video" autoplay></video>' +
      '<div class="tv-player__overlay">' +
        '<div class="tv-player__title">' + title + '</div>' +
      '</div>' +
    '</div>'
  );
  video = $root.find('video')[0] as HTMLVideoElement;
  plog.debug('video element rendered', { videoExists: !!video });

  if (video) {
    // Логирование видео-событий
    video.addEventListener('play', () => plog.debug('video: play'));
    video.addEventListener('playing', () => plog.debug('video: playing'));
    video.addEventListener('pause', () => plog.debug('video: pause'));
    video.addEventListener('ended', () => plog.debug('video: ended'));
    video.addEventListener('error', (e) => {
      const err = video?.error;
      plog.error('video: error', {
        code: err?.code,
        message: err?.message
      });
    });
    video.addEventListener('stalled', () => plog.debug('video: stalled'));
    video.addEventListener('waiting', () => plog.debug('video: waiting'));
    video.addEventListener('loadstart', () => plog.debug('video: loadstart'));
    video.addEventListener('progress', () => plog.debug('video: progress'));
    video.addEventListener('suspend', () => plog.debug('video: suspend'));
    video.addEventListener('abort', () => plog.debug('video: abort'));
    video.addEventListener('emptied', () => plog.debug('video: emptied'));
    video.addEventListener('loadedmetadata', () => plog.debug('video: loadedmetadata'));
    video.addEventListener('loadeddata', () => plog.debug('video: loadeddata'));
    video.addEventListener('canplay', () => plog.debug('video: canplay'));
    video.addEventListener('canplaythrough', () => plog.debug('video: canplaythrough'));
    video.addEventListener('durationchange', () => plog.debug('video: durationchange', { duration: video.duration }));
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
  plog.debug('startPlayback called', { streamUrl, videoExists: !!video });
  if (!video) {
    plog.error('video element not found');
    return;
  }
  const HlsCtor = (window as any).Hls;
  plog.debug('HLS check', { hlsExists: !!HlsCtor, hlsSupported: HlsCtor && HlsCtor.isSupported() });
  if (HlsCtor && HlsCtor.isSupported()) {
    plog.info('Using HLS.js');
    hls = new HlsCtor({
      maxBufferLength: 30,
      maxMaxBufferLength: 60
    });
    plog.debug('HLS instance created');
    hls.loadSource(streamUrl);
    plog.debug('HLS source loaded', { streamUrl });
    hls.attachMedia(video);
    plog.debug('HLS attached to video element');
    hls.on(HlsCtor.Events.ERROR, (event: unknown, data: any) => {
      plog.error('HLS error', {
        fatal: data?.fatal,
        type: data?.type,
        details: data?.details,
        error: data?.error,
        fullData: JSON.stringify(data)
      });
      if (data && data.fatal) {
        if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
          plog.warn('Media error, attempting recovery');
          try {
            hls.recoverMediaError();
          } catch (e) {
            plog.error('Recovery failed', { error: String(e) });
          }
        } else {
          plog.error('Fatal HLS error, stopping playback');
          stopPlayback();
          goBack();
        }
      }
    });
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
      goBack();
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
    stopPlayback();
    keys.unbind();
    clearPage($root);
  }
};
