import { MOOD_IDS } from '@seedbeat/core';
import { ACHIEVEMENTS } from '../app/achievements';
import { controller } from '../app/controller';
import { currentStreak } from '../app/daily';
import { MOOD_LABEL, fmtTime } from '../app/format';
import { HIGHWAY_LIST, NOTE_SKIN_LIST, unlocked, xpForLevel } from '../app/progression';
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
  const have = new Set(s.profile.achievements);
  const streak = currentStreak(s.streak, controller.today());
  const level = s.profile.level;
  const cosmetics = [...NOTE_SKIN_LIST, ...HIGHWAY_LIST].filter((c) => unlocked(c, level)).length;
  return (
    <Screen
      id="profile"
      title="Profile"
      lede="Everything here is stored on this device. Export it from Settings to move it."
    >
      <dl class="proflist">
        <dt>Level</dt>
        <dd>
          {level} · {s.profile.xp.toLocaleString()} XP · next at{' '}
          {xpForLevel(level + 1).toLocaleString()}
        </dd>
        <dt>Plays</dt>
        <dd>{s.profile.plays}</dd>
        <dt>Play time</dt>
        <dd>{fmtTime(s.profile.playSec)}</dd>
        <dt>Seeds with a best</dt>
        <dd>{bests.length}</dd>
        <dt>Mastery stars</dt>
        <dd>{bests.reduce((acc, [, b]) => acc + b.stars, 0)}</dd>
        <dt>Grades</dt>
        <dd>{['S', 'A', 'B', 'C', 'D', 'F'].map((g) => `${g} ${grades[g] ?? 0}`).join(' · ')}</dd>
        <dt>Daily streak</dt>
        <dd>
          {streak} day{streak === 1 ? '' : 's'} · {Object.keys(s.daily).length} dailies cleared
        </dd>
        <dt>Practice sessions</dt>
        <dd>{s.profile.practiceRuns}</dd>
        <dt>Cosmetics unlocked</dt>
        <dd>
          {cosmetics} of {NOTE_SKIN_LIST.length + HIGHWAY_LIST.length}
        </dd>
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
      <h3>
        Achievements · {have.size} of {ACHIEVEMENTS.length}
      </h3>
      <ul class="achlist" aria-label="Achievements">
        {ACHIEVEMENTS.map((a) => (
          <li key={a.id} class={have.has(a.id) ? 'got' : 'locked'}>
            <b>{a.name}</b> <span class="meta">{a.desc}</span>
          </li>
        ))}
      </ul>
      <div class="btnrow">
        <button type="button" class="btn primary" onClick={() => controller.closeOverlay()}>
          DONE
        </button>
      </div>
    </Screen>
  );
}
