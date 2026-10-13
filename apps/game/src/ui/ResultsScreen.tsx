import { MOODS } from '@seedbeat/core';
import { controller } from '../app/controller';
import { DIFF_LABEL, MOOD_LABEL, fmtTime, randomSeed } from '../app/format';
import { copyText, deepLink, resultCard, shareCard } from '../app/share';
import { results, screen, selection, showToast } from '../app/state';
import { Screen } from './components';
import { Histogram, TimingGraph } from './TimingGraph';

export function ResultsScreen() {
  const r = results.value;
  if (!r) return null;
  const s = r.summary;
  const endless = r.selection.mode === 'endless';
  const status = endless
    ? `Survived ${fmtTime(r.durationSec)} · ${r.bars ?? 0} bars · peak level ${(r.peakLevel ?? 0).toFixed(1)}`
    : s.failed
      ? 'Failed'
      : 'Cleared';
  const meta = `${MOOD_LABEL[r.selection.mood]} · ${DIFF_LABEL[r.selection.difficulty]} · seed ${r.selection.seed}`;
  const pal = MOODS[r.selection.mood].palette;
  const share = async (): Promise<void> => {
    const ok = await copyText(deepLink(r.selection));
    showToast(ok ? 'Link copied. Making the result card…' : 'Could not copy the link.');
    try {
      const blob = await resultCard(r, pal.accent, pal.accent2, pal.bg);
      const how = await shareCard(blob, `seedbeat-${r.selection.seed}.png`);
      showToast(how === 'shared' ? 'Shared.' : 'Result card downloaded.');
    } catch {
      showToast('Card sharing is not available here.');
    }
  };
  return (
    <Screen id="results" title={r.songName} lede={`${status} · ${meta}`}>
      <div class="grade">
        <div class={`letter${r.grade === 'F' ? ' f' : ''}`} aria-label={`Grade ${r.grade}`}>
          {r.grade}
        </div>
        <div class="who">
          <span class="stars" aria-label={`${r.stars} of 5 mastery stars`}>
            {'★'.repeat(r.stars)}
            {'☆'.repeat(5 - r.stars)}
          </span>
          {r.isBest && <span class="newbest">New best for this seed</span>}
          {s.lateInputs > 0 && (
            <span class="meta">{s.lateInputs} inputs arrived too late to count</span>
          )}
        </div>
      </div>
      <div class="stats" role="list">
        <div class="wide" role="listitem">
          <span class="lbl">Score</span>
          <b>{s.score.toLocaleString()}</b>
        </div>
        <div role="listitem">
          <span class="lbl">Accuracy</span>
          <b>{(s.accuracy * 100).toFixed(1)}%</b>
        </div>
        <div role="listitem">
          <span class="lbl">Max combo</span>
          <b>{s.maxCombo}</b>
        </div>
        <div role="listitem">
          <span class="lbl">Perfect</span>
          <b>{s.counts.perfect}</b>
        </div>
        <div role="listitem">
          <span class="lbl">Great</span>
          <b>{s.counts.great}</b>
        </div>
        <div role="listitem">
          <span class="lbl">Good</span>
          <b>{s.counts.good}</b>
        </div>
        <div role="listitem">
          <span class="lbl">Miss</span>
          <b>{s.counts.miss}</b>
        </div>
      </div>
      <TimingGraph events={r.events} duration={r.durationSec} />
      <Histogram events={r.events} />
      <div class="btnrow">
        <button type="button" class="btn primary" onClick={() => void controller.startRun()}>
          RETRY
        </button>
        <button
          type="button"
          class="btn"
          onClick={() => {
            selection.value = { ...selection.value, seed: randomSeed() };
            void controller.startRun();
          }}
        >
          New seed
        </button>
        <button type="button" class="btn" onClick={() => void share()}>
          Share
        </button>
        <button
          type="button"
          class="btn"
          onClick={() => {
            screen.value = 'select';
            void controller.ensureIdle();
          }}
        >
          Menu
        </button>
      </div>
    </Screen>
  );
}
