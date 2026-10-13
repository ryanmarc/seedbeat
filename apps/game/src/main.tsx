import { render } from 'preact';
import './styles.css';
import { controller } from './app/controller';
import { App } from './ui/App';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

render(<App />, ui);
void controller.boot(canvas).catch((err) => {
  ui.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});

// e2e hooks
declare global {
  interface Window {
    __seedbeat?: { screen: () => string; controller: typeof controller };
  }
}
window.__seedbeat = { screen: () => controller.currentScreen, controller };
