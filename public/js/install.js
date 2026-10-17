// "Install Acalyze" for every kind of device: Android and desktop Chrome/Edge show the browser's own
// install dialog; iPhone, iPad and Mac Safari have no such dialog, so we show the steps instead.
import { modal } from './ui.js';

let deferred = null;
// Browser-only: the tests load this file in Node, where there is no window.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; });
  window.addEventListener('appinstalled', () => { deferred = null; });
}

// True when Acalyze is already running as an installed app (home screen, desktop window, or the Android app).
export const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = () => /android/i.test(navigator.userAgent);

const STEPS = {
  ios: ['Open Acalyze in <b>Safari</b>.', 'Tap the <b>Share</b> button (a square with an arrow pointing up).', 'Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.'],
  android: ['Open Acalyze in <b>Chrome</b>.', 'Tap the menu <b>⋮</b> at the top right.', 'Tap <b>Install app</b> (or <b>Add to Home screen</b>).'],
  desktop: ['Use <b>Chrome</b> or <b>Edge</b>.', 'Click the <b>install icon</b> at the right end of the address bar, or open the menu and choose <b>Install Acalyze</b>.', 'On a Mac with Safari, choose <b>File → Add to Dock</b>.'],
};

export async function installApp() {
  if (deferred) {
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null;
    return;
  }
  const kind = isIOS() ? 'ios' : isAndroid() ? 'android' : 'desktop';
  modal(`<h3>Install Acalyze</h3><p class="sm mut" style="margin:6px 0 12px">It opens like any other app, with its own icon, and stays up to date by itself.</p>
    <ol style="margin:0 0 16px;padding-left:20px;line-height:1.7">${STEPS[kind].map((s) => `<li>${s}</li>`).join('')}</ol>
    <div class="row" style="justify-content:flex-end"><button class="btn primary" data-close>Got it</button></div>`);
}
