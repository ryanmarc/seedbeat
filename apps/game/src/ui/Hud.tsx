import { controller } from '../app/controller';
import { countdown, hudAcc, hudHealth, hudProgress, hudScore, hudSection } from '../app/state';

export function Hud() {
  return (
    <div id="hud" role="status" aria-live="off">
      <div class="hud-row">
        <div class="hud-cell">
          <span class="lbl">Score</span>
          <span class="v">{hudScore.value.toLocaleString()}</span>
        </div>
        <div class="hud-mid">
          <div
            class="health"
            role="meter"
            aria-label="Health"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={hudHealth.value}
          >
            <i style={{ transform: `scaleX(${hudHealth.value})` }} />
          </div>
          <span class="lbl hud-section">
            {countdown.value ? `Resuming in ${countdown.value}` : hudSection.value}
          </span>
        </div>
        <div class="hud-cell r">
          <span class="lbl">Accuracy</span>
          <span class="v">{hudAcc.value}</span>
        </div>
        <button
          type="button"
          class="icon-btn"
          aria-label="Pause"
          onClick={() => controller.pause()}
        >
          ❚❚
        </button>
      </div>
      <div class="progress">
        <i style={{ transform: `scaleX(${hudProgress.value})` }} />
      </div>
    </div>
  );
}
