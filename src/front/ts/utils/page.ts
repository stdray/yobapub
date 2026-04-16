import $ from 'jquery';
import { TvKey } from './platform';

const SPINNER_HTML = '<div class="spinner"><div class="spinner__circle"></div></div>';

export class PageKeys {
  private handler: ((e: JQuery.Event) => void) | null = null;

  bind = (fn: (e: JQuery.Event) => void): void => {
    this.handler = fn;
    $(window).on('keydown', this.handler);
  };

  unbind = (): void => {
    if (this.handler) { $(window).off('keydown', this.handler); this.handler = null; }
  };
}

export class PageUtils {
  static showSpinnerIn = ($el: JQuery): void => {
    $el.html(SPINNER_HTML);
  };

  static clearPage = ($el: JQuery): void => {
    $el.empty();
  };

  static scrollIntoView = (el: HTMLElement, container: HTMLElement, margin?: number): void => {
    if (!el || !container) return;
    const m = margin || 40;
    const elRect = el.getBoundingClientRect();
    const contRect = container.getBoundingClientRect();
    const elTop = elRect.top - contRect.top + container.scrollTop;
    const elBottom = elTop + elRect.height;
    const scrollTop = container.scrollTop;
    const viewH = container.clientHeight;
    if (elBottom > scrollTop + viewH - m) {
      container.scrollTop = elBottom - viewH + m;
    } else if (elTop < scrollTop + m) {
      container.scrollTop = Math.max(0, elTop - m);
    }
  };
}

let confirmKeyHandler: ((e: JQuery.Event) => void) | null = null;

const closeConfirm = (): void => {
  $('#exit-dialog').addClass('hidden');
  if (confirmKeyHandler) {
    $(window).off('keydown', confirmKeyHandler);
    confirmKeyHandler = null;
  }
};

export const showConfirmDialog = (text: string, onYes: () => void): void => {
  const $d = $('#exit-dialog');
  $d.find('.exit-dialog__text').text(text);
  let focusedYes = false;
  const updateFocus = (): void => {
    $d.find('.exit-dialog__btn--yes').toggleClass('focused', focusedYes);
    $d.find('.exit-dialog__btn--no').toggleClass('focused', !focusedYes);
  };
  $d.removeClass('hidden');
  updateFocus();

  confirmKeyHandler = (e: JQuery.Event): void => {
    switch (e.keyCode) {
      case TvKey.Left:
      case TvKey.Right:
        focusedYes = !focusedYes;
        updateFocus();
        e.preventDefault(); e.stopPropagation(); break;
      case TvKey.Enter:
        closeConfirm();
        if (focusedYes) onYes();
        e.preventDefault(); e.stopPropagation(); break;
      case TvKey.Return:
      case TvKey.Backspace:
      case TvKey.Escape:
        closeConfirm();
        e.preventDefault(); e.stopPropagation(); break;
    }
  };
  $(window).on('keydown', confirmKeyHandler);
};