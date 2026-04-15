import $ from 'jquery';
import { TvKey } from './platform';

// Lightweight confirm dialog, reusing the existing `#exit-dialog` DOM node for
// styling (same box/button classes). Shown on top of the current page; Yes
// fires `onYes`, anything else closes silently.

let keyHandler: ((e: JQuery.Event) => void) | null = null;

const $dialog = (): JQuery => $('#exit-dialog');

const close = (): void => {
  $dialog().addClass('hidden');
  if (keyHandler) {
    $(window).off('keydown', keyHandler);
    keyHandler = null;
  }
};

export const showConfirmDialog = (text: string, onYes: () => void): void => {
  const $d = $dialog();
  $d.find('.exit-dialog__text').text(text);
  let focusedYes = false;
  const updateFocus = (): void => {
    $d.find('.exit-dialog__btn--yes').toggleClass('focused', focusedYes);
    $d.find('.exit-dialog__btn--no').toggleClass('focused', !focusedYes);
  };
  $d.removeClass('hidden');
  updateFocus();

  keyHandler = (e: JQuery.Event): void => {
    switch (e.keyCode) {
      case TvKey.Left:
      case TvKey.Right:
        focusedYes = !focusedYes;
        updateFocus();
        e.preventDefault(); e.stopPropagation(); break;
      case TvKey.Enter:
        close();
        if (focusedYes) onYes();
        e.preventDefault(); e.stopPropagation(); break;
      case TvKey.Return:
      case TvKey.Backspace:
      case TvKey.Escape:
        close();
        e.preventDefault(); e.stopPropagation(); break;
    }
  };
  $(window).on('keydown', keyHandler);
};
