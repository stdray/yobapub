import $ from 'jquery';

var SPINNER_HTML = '<div class="spinner"><div class="spinner__circle"></div></div>';

export interface PageKeys {
  bind(fn: (e: JQuery.Event) => void): void;
  unbind(): void;
}

export function pageKeys(): PageKeys {
  var handler: ((e: JQuery.Event) => void) | null = null;
  return {
    bind: function (fn: (e: JQuery.Event) => void) {
      handler = fn;
      $(window).on('keydown', handler);
    },
    unbind: function () {
      if (handler) { $(window).off('keydown', handler); handler = null; }
    }
  };
}

export function showSpinnerIn($el: JQuery): void {
  $el.html(SPINNER_HTML);
}

export function clearPage($el: JQuery): void {
  $el.empty();
}
