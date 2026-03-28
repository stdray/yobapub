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

export function scrollIntoView(el: HTMLElement, container: HTMLElement, margin?: number): void {
  if (!el || !container) return;
  var m = margin || 40;
  var elRect = el.getBoundingClientRect();
  var contRect = container.getBoundingClientRect();
  var elTop = elRect.top - contRect.top + container.scrollTop;
  var elBottom = elTop + elRect.height;
  var scrollTop = container.scrollTop;
  var viewH = container.clientHeight;
  if (elBottom > scrollTop + viewH - m) {
    container.scrollTop = elBottom - viewH + m;
  } else if (elTop < scrollTop + m) {
    container.scrollTop = Math.max(0, elTop - m);
  }
}
