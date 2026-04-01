import $ from 'jquery';

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
