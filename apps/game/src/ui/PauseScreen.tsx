import { controller } from '../app/controller';
import { DIFF_LABEL, MOOD_LABEL } from '../app/format';
import { selection } from '../app/state';
import { Screen } from './components';

export function PauseScreen() {
  const s = selection.value;
  return (
    <Screen
      id="pause"
      title="Paused"
      lede={`${MOOD_LABEL[s.mood]} · ${DIFF_LABEL[s.difficulty]} · seed ${s.seed}. Resuming counts in three beats with the music.`}
    >
      <div class="btnrow">
        <button type="button" class="btn primary" onClick={() => controller.resume()}>
          RESUME
        </button>
        <button type="button" class="btn" onClick={() => controller.restart()}>
          Restart
        </button>
        <button type="button" class="btn" onClick={() => controller.openOverlay('settings')}>
          Settings
        </button>
        <button type="button" class="btn" onClick={() => controller.quit()}>
          Quit to menu
        </button>
      </div>
    </Screen>
  );
}
