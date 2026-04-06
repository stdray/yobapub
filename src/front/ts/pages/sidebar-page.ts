import $ from 'jquery';
import { Page, RouteParams } from '../types/app';
import { PageKeys, PageUtils } from '../utils/page';
import { sidebar } from '../sidebar';

export abstract class SidebarPage implements Page {
  protected readonly $root: JQuery;
  protected readonly keys = new PageKeys();

  constructor(rootId: string) {
    this.$root = $(`#page-${rootId}`);
  }

  mount(params: RouteParams): void {
    this.$root.removeClass('sidebar-active');
    sidebar.setFocusHandler(() => this.$root.addClass('sidebar-active'));
    sidebar.setUnfocusHandler(() => { this.$root.removeClass('sidebar-active'); this.onUnfocus(); });
    this.keys.bind(sidebar.wrapKeys((e) => this.handleKey(e)));
    this.onMount(params);
  }

  unmount(): void {
    this.keys.unbind();
    PageUtils.clearPage(this.$root);
    sidebar.setFocusHandler(null);
    sidebar.setUnfocusHandler(null);
    this.onUnmount();
  }

  protected abstract onUnfocus(): void;
  protected abstract handleKey(e: JQuery.Event): void;
  protected abstract onMount(params: RouteParams): void;
  protected abstract onUnmount(): void;
}
