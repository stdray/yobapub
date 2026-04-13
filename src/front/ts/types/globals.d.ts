/* eslint-disable no-var -- ambient declarations require var */
declare var __APP_VERSION__: string;
declare var __BUILD_SHA__: string;
declare var __BUILD_SHORT_SHA__: string;
declare var __BUILD_DATE__: string;

/** Android WebView native bridge (injected by the host app). */
interface NativeApp {
  exit(): void;
}

interface Window {
  NativeApp?: NativeApp;
}
