import $ from 'jquery';
import { TvKey } from './platform';

let focusedYes = true;
let onClose: (() => void) | null = null;
let keyHandler: ((e: JQuery.Event) => void) | null = null;

const $dialog = () => $('#exit-dialog');

const updateFocus = () => {
  $dialog().find('.exit-dialog__btn--yes').toggleClass('focused', focusedYes);
  $dialog().find('.exit-dialog__btn--no').toggleClass('focused', !focusedYes);
};

const close = () => {
  $dialog().addClass('hidden');
  if (keyHandler) {
    $(window).off('keydown', keyHandler);
    keyHandler = null;
  }
};

export const showExitDialog = (closeApp: () => void): void => {
  onClose = closeApp;
  focusedYes = false;
  $dialog().removeClass('hidden');
  updateFocus();

  keyHandler = (e: JQuery.Event) => {
    switch (e.keyCode) {
      case TvKey.Left:
      case TvKey.Right:
        focusedYes = !focusedYes;
        updateFocus();
        e.preventDefault(); e.stopPropagation(); break;
      case TvKey.Enter:
        close();
        if (focusedYes && onClose) onClose();
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
