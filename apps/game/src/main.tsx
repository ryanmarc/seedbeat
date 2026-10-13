import { render } from 'preact';
import './styles.css';
import { controller } from './app/controller';
import { showToast } from './app/state';
import { isStandalone, watchInstall } from './platform/install';
import { registerServiceWorker } from './platform/sw';
import { App } from './ui/App';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

watchInstall({ target: window, standalone: () => isStandalone() });
render(<App />, ui);
void controller.boot(canvas).catch((err) => {
  ui.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});

// e2e hooks
declare global {
  interface Window {
    __seedbeat?: { screen: () => string; controller: typeof controller; sw: Promise<string> };
  }
}
const sw = registerServiceWorker({
  onUpdate: () =>
    showToast('Seedbeat has updated. Close and reopen it to get the new version.', 5000),
});
window.__seedbeat = { screen: () => controller.currentScreen, controller, sw };
