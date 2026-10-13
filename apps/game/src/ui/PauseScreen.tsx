import { controller } from '../app/controller';
import { DIFF_LABEL, MOOD_LABEL } from '../app/format';
import { selection } from '../app/state';
import { Screen } from './components';

export function PauseScreen() {
  const s = selection.value;
  const kind = controller.currentKind;
  const lede =
    kind === 'tutorial'
      ? 'Tutorial. Resuming counts in three beats with the music.'
      : `${MOOD_LABEL[s.mood]} · ${DIFF_LABEL[s.difficulty]} · seed ${s.seed}. Resuming counts in three beats with the music.`;
  return (
    <Screen id="pause" title="Paused" lede={lede}>
      <div class="btnrow">
        <button type="button" class="btn primary" onClick={() => controller.resume()}>
          RESUME
        </button>
        {kind === 'practice' && (
          <button type="button" class="btn" onClick={() => controller.stopRun()}>
            Finish practice
          </button>
        )}
        {kind === 'tutorial' && (
          <button type="button" class="btn" onClick={() => controller.skipTutorial()}>
            Skip tutorial
          </button>
        )}
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
