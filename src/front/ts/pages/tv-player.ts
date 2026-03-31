import $ from 'jquery';
import { Page, RouteParams } from '../types/app';
import { goBack } from '../router';
import { TvKey } from '../utils/platform';
import { pageKeys, clearPage } from '../utils/page';

const $root = $('#page-tv-player');
const keys = pageKeys();
let hls: any = null;
let video: HTMLVideoElement | null = null;

function render(title: string): void {
  $root.html(
    '<div class="tv-player">' +
      '<video class="tv-player__video" autoplay></video>' +
      '<div class="tv-player__overlay">' +
        '<div class="tv-player__title">' + title + '</div>' +
      '</div>' +
    '</div>'
  );
  video = $root.find('video')[0] as HTMLVideoElement;
}

function startPlayback(streamUrl: string): void {
  if (!video) return;
  const HlsCtor = (window as any).Hls;
  if (HlsCtor && HlsCtor.isSupported()) {
    hls = new HlsCtor({
      maxBufferLength: 30,
      maxMaxBufferLength: 60
    });
    hls.loadSource(streamUrl);
    hls.attachMedia(video);
    hls.on(HlsCtor.Events.ERROR, (_: unknown, data: { fatal: boolean; type: string }) => {
      if (data.fatal) {
        if (data.type === HlsCtor.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
        } else {
          stopPlayback();
          goBack();
        }
      }
    });
  } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
    video.src = streamUrl;
  }
}

function stopPlayback(): void {
  if (hls) { hls.destroy(); hls = null; }
  if (video) { video.pause(); video.src = ''; video = null; }
}

const handleKey = (e: JQuery.Event): void => {
  switch (e.keyCode) {
    case TvKey.Enter:
      if (video) {
        if (video.paused) { video.play().catch(() => { /* ignore */ }); }
        else { video.pause(); }
      }
      e.preventDefault(); break;
    case TvKey.Return:
    case TvKey.Backspace:
    case TvKey.Escape:
    case TvKey.Stop:
      stopPlayback();
      goBack();
      e.preventDefault(); break;
  }
};

export const tvPlayerPage: Page = {
  mount(params: RouteParams): void {
    render(params.channelTitle || '');
    startPlayback(params.channelStream || '');
    keys.bind(handleKey);
  },
  unmount(): void {
    stopPlayback();
    keys.unbind();
    clearPage($root);
  }
};
