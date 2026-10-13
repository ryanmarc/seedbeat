import { MOOD_IDS } from '@seedbeat/core';
import { controller } from '../app/controller';
import { MOOD_LABEL, fmtTime } from '../app/format';
import { save } from '../app/state';
import { Screen } from './components';

export function ProfileScreen() {
  const s = save.value;
  const bests = Object.entries(s.bests);
  const grades: Record<string, number> = {};
  for (const [, b] of bests) grades[b.grade] = (grades[b.grade] ?? 0) + 1;
  const perMood = MOOD_IDS.map((m) => {
    const mine = bests.filter(([k]) => k.split(':')[1] === m);
    const top = mine.reduce((acc, [, b]) => Math.max(acc, b.score), 0);
    return { m, plays: mine.length, top };
  });
  return (
    <Screen
      id="profile"
      title="Profile"
      lede="Everything here is stored on this device. Export it from Settings to move it."
    >
      <dl class="proflist">
        <dt>Level</dt>
        <dd>
          {s.profile.level} · {s.profile.xp} XP
        </dd>
        <dt>Plays</dt>
        <dd>{s.profile.plays}</dd>
        <dt>Play time</dt>
        <dd>{fmtTime(s.profile.playSec)}</dd>
        <dt>Seeds with a best</dt>
        <dd>{bests.length}</dd>
        <dt>Grades</dt>
        <dd>{['S', 'A', 'B', 'C', 'D', 'F'].map((g) => `${g} ${grades[g] ?? 0}`).join(' · ')}</dd>
        <dt>Daily streak</dt>
        <dd>{s.streak.current} days</dd>
        <dt>Achievements</dt>
        <dd>{s.profile.achievements.length} (arrive in the next milestone)</dd>
      </dl>
      <h3>Per mood</h3>
      <dl class="proflist">
        {perMood.map((p) => (
          <>
            <dt key={`${p.m}-t`}>{MOOD_LABEL[p.m]}</dt>
            <dd key={`${p.m}-d`}>
              {p.plays ? `${p.plays} seeds · best ${p.top.toLocaleString()}` : '—'}
            </dd>
          </>
        ))}
      </dl>
      <div class="btnrow">
        <button type="button" class="btn primary" onClick={() => controller.closeOverlay()}>
          DONE
        </button>
      </div>
    </Screen>
  );
}
